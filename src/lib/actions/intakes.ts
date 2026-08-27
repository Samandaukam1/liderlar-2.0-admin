"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  promoteIntakeToDraft,
  publishPromotedIntake,
} from "@/lib/intake/promotion-service";
import { logAudit } from "@/lib/audit";
import { validateContact } from "@/lib/intake/schemas";
import {
  generateRawIntakeToken,
  hashIntakeToken,
  tokenPrefix,
  buildIntakeLink,
} from "@/lib/intake/tokens";
import { getActiveTemplate, getIntakeSettings } from "@/lib/intake/data";
import { saveIntakeAnswer } from "@/lib/intake/answers";
import type { AnswerState } from "@/lib/intake/constants";

export interface IntakeActionResult {
  ok: boolean;
  error?: string;
  id?: string;
  link?: string;
  prefix?: string;
  expiresAt?: string;
  candidateId?: string;
  articleId?: string;
  slug?: string;
  conflict?: boolean;
  server?: unknown;
  lockVersion?: number;
}


/**
 * Resolves the intake public base URL from the LIVE request at runtime, so the
 * generated link always matches the real deployment (Vercel domain, custom
 * domain, or localhost) instead of a value frozen into the build. An explicit
 * server-only `INTAKE_BASE_URL` override wins when set.
 */
async function resolveIntakeBaseUrl(): Promise<string | undefined> {
  const override = process.env.INTAKE_BASE_URL?.trim();
  if (override) return override;
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host) return undefined;
    const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
    const proto = h.get("x-forwarded-proto") ?? (isLocal ? "http" : "https");
    return `${proto}://${host}/anketa`;
  } catch {
    return undefined;
  }
}

async function createLinkFor(intakeId: string, actorId: string, ttlDays: number) {
  const admin = createSupabaseAdminClient();
  // Retire any existing active link first.
  await admin
    .from("candidate_intake_links")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("intake_id", intakeId)
    .eq("status", "active");

  const raw = generateRawIntakeToken();
  const expiresAt = new Date(Date.now() + ttlDays * 86400000).toISOString();
  const { error } = await admin.from("candidate_intake_links").insert({
    intake_id: intakeId,
    token_hash: hashIntakeToken(raw),
    token_prefix: tokenPrefix(raw),
    status: "active",
    expires_at: expiresAt,
    created_by: actorId,
  });
  if (error) return { ok: false as const, error: error.message };
  // Base derived from the live request → correct URL on every deployment.
  const base = await resolveIntakeBaseUrl();
  return { ok: true as const, link: buildIntakeLink(raw, base), prefix: tokenPrefix(raw), expiresAt };
}

/* --------------------------- create --------------------------- */

async function createIntake(
  formData: FormData,
  method: "manual" | "secure_link",
): Promise<IntakeActionResult> {
  const ctx = await requirePermission("intakes.create");
  // Single free-text full name + required gender (drives photo AI + form theme).
  const fullName = String(formData.get("full_name") ?? "").trim();
  const gender = String(formData.get("gender") ?? "");
  if (fullName.length < 3) return { ok: false, error: "Ism familiya kiritilishi shart (kamida 3 belgi)" };
  if (gender !== "male" && gender !== "female") return { ok: false, error: "Jins tanlanishi shart" };

  const template = await getActiveTemplate();
  if (!template) return { ok: false, error: "Faol anketa shabloni topilmadi (migration/seed?)" };

  const admin = createSupabaseAdminClient();
  // first_name/last_name/father_name kept at their DB defaults ('') — full_name
  // is now the single source of truth.
  const { data, error } = await admin
    .from("candidate_intakes")
    .insert({
      template_id: template.id,
      intake_method: method,
      status: "draft",
      full_name: fullName.slice(0, 200),
      gender,
      created_by: ctx.userId,
      assigned_admin: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Yaratib bo‘lmadi" };

  await logAudit({
    actorId: ctx.userId,
    action: `intake.create.${method}`,
    entityType: "candidate_intake",
    entityId: data.id,
    newValue: { full_name: fullName, gender, method },
  });

  revalidatePath("/nomzodlar/anketalar");
  return { ok: true, id: data.id as string };
}

export async function createManualIntakeAction(formData: FormData): Promise<IntakeActionResult> {
  return createIntake(formData, "manual");
}

export async function createSecureLinkIntakeAction(formData: FormData): Promise<IntakeActionResult> {
  const base = await createIntake(formData, "secure_link");
  if (!base.ok || !base.id) return base;

  const ctx = await requirePermission("intakes.link");
  const settings = await getIntakeSettings();
  const link = await createLinkFor(base.id, ctx.userId, settings.linkTtlDays);
  if (!link.ok) return { ok: false, error: link.error };

  await logAudit({
    actorId: ctx.userId,
    action: "intake.link.create",
    entityType: "candidate_intake",
    entityId: base.id,
    metadata: { prefix: link.prefix, expiresAt: link.expiresAt }, // raw token never logged
  });

  // Raw link returned to the creating admin exactly once.
  return { ok: true, id: base.id, link: link.link, prefix: link.prefix, expiresAt: link.expiresAt };
}

/* --------------------------- link management --------------------------- */

export async function regenerateLinkAction(intakeId: string): Promise<IntakeActionResult> {
  const ctx = await requirePermission("intakes.link");
  const settings = await getIntakeSettings();
  const link = await createLinkFor(intakeId, ctx.userId, settings.linkTtlDays);
  if (!link.ok) return { ok: false, error: link.error };
  await logAudit({
    actorId: ctx.userId,
    action: "intake.link.regenerate",
    entityType: "candidate_intake",
    entityId: intakeId,
    metadata: { prefix: link.prefix, expiresAt: link.expiresAt },
    severity: "warning",
  });
  revalidatePath(`/nomzodlar/anketalar/${intakeId}`);
  return { ok: true, link: link.link, prefix: link.prefix, expiresAt: link.expiresAt };
}

export async function revokeLinkAction(intakeId: string): Promise<IntakeActionResult> {
  const ctx = await requirePermission("intakes.link");
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("candidate_intake_links")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("intake_id", intakeId)
    .eq("status", "active");
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "intake.link.revoke",
    entityType: "candidate_intake",
    entityId: intakeId,
    severity: "warning",
  });
  revalidatePath(`/nomzodlar/anketalar/${intakeId}`);
  return { ok: true };
}

export async function extendLinkAction(intakeId: string): Promise<IntakeActionResult> {
  const ctx = await requirePermission("intakes.link");
  const settings = await getIntakeSettings();
  const admin = createSupabaseAdminClient();
  const expiresAt = new Date(Date.now() + settings.linkTtlDays * 86400000).toISOString();
  const { error } = await admin
    .from("candidate_intake_links")
    .update({ expires_at: expiresAt })
    .eq("intake_id", intakeId)
    .eq("status", "active");
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "intake.link.extend",
    entityType: "candidate_intake",
    entityId: intakeId,
    metadata: { expiresAt },
  });
  revalidatePath(`/nomzodlar/anketalar/${intakeId}`);
  return { ok: true, expiresAt };
}

/* --------------------------- manual answers --------------------------- */

export async function saveManualAnswerAction(
  intakeId: string,
  payload: {
    questionNo: number;
    answerState: AnswerState;
    richContent: unknown;
    plainText: string;
    lockVersion: number;
  },
): Promise<IntakeActionResult> {
  const ctx = await requirePermission("intakes.edit");
  const outcome = await saveIntakeAnswer({
    intakeId,
    questionNo: payload.questionNo,
    answerState: payload.answerState,
    richContent: payload.richContent,
    plainText: payload.plainText,
    lockVersion: payload.lockVersion,
    source: "admin",
    editedBy: ctx.userId,
  });
  if (!outcome.ok) {
    if ("conflict" in outcome) return { ok: false, conflict: true, server: outcome.server };
    return { ok: false, error: outcome.error };
  }
  revalidatePath(`/nomzodlar/anketalar/${intakeId}`);
  return { ok: true, lockVersion: outcome.lockVersion };
}

/** Admin final edit of an AI-improved answer. */
export async function saveFinalAnswerAction(
  intakeId: string,
  questionNo: number,
  finalText: string,
  editorState: "accepted" | "partially_accepted" | "rejected" | "manual",
): Promise<IntakeActionResult> {
  const ctx = await requirePermission("intakes.review");
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("candidate_intake_answers")
    .update({ final_text: finalText, editor_state: editorState })
    .eq("intake_id", intakeId)
    .eq("question_no", questionNo);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "intake.answer.final",
    entityType: "candidate_intake",
    entityId: intakeId,
    metadata: { questionNo, editorState },
  });
  revalidatePath(`/nomzodlar/anketalar/${intakeId}`);
  return { ok: true };
}

/** Admin "finish manual entry": save contact/consent then run the submit RPC. */
export async function submitManualIntakeAction(
  intakeId: string,
  contact: { phone: string; telegram: string; consent: boolean },
): Promise<IntakeActionResult> {
  const ctx = await requirePermission("intakes.edit");
  const check = validateContact(contact);
  if (!check.ok) return { ok: false, error: check.errors.join(" · ") };

  const settings = await getIntakeSettings();
  const admin = createSupabaseAdminClient();
  await admin
    .from("candidate_intakes")
    .update({
      phone_e164: check.phone,
      telegram_username: check.telegram,
      consent_given: contact.consent === true,
      consent_text_version: settings.consentVersion,
      consent_at: new Date().toISOString(),
    })
    .eq("id", intakeId);

  const { data: result, error } = await admin.rpc("submit_candidate_intake", {
    p_intake: intakeId,
    p_actor: ctx.userId,
  });
  if (error) return { ok: false, error: error.message };
  const res = result as { ok: boolean; errors?: string[] };
  if (!res?.ok) return { ok: false, error: (res?.errors ?? ["Yuborib bo‘lmadi"]).join(" · ") };

  await logAudit({
    actorId: ctx.userId,
    action: "intake.submit.manual",
    entityType: "candidate_intake",
    entityId: intakeId,
  });
  revalidatePath(`/nomzodlar/anketalar/${intakeId}`);
  return { ok: true };
}

/* --------------------------- review lifecycle --------------------------- */

export async function approveIntakeAction(intakeId: string): Promise<IntakeActionResult> {
  const ctx = await requirePermission("intakes.approve");
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("candidate_intakes")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", intakeId)
    .in("status", ["submitted", "ai_reviewing", "needs_clarification"]);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "intake.approve",
    entityType: "candidate_intake",
    entityId: intakeId,
  });
  revalidatePath(`/nomzodlar/anketalar/${intakeId}`);
  return { ok: true };
}

export async function requestClarificationAction(
  intakeId: string,
  comment: string,
  questionNo?: number,
): Promise<IntakeActionResult> {
  const ctx = await requirePermission("intakes.review");
  if (!comment.trim()) return { ok: false, error: "Izoh bo‘sh bo‘lishi mumkin emas" };
  const admin = createSupabaseAdminClient();
  await admin.from("candidate_intake_review_comments").insert({
    intake_id: intakeId,
    question_no: questionNo ?? null,
    kind: "clarification",
    body: comment.trim(),
    status: "open",
    author_id: ctx.userId,
  });
  const { error } = await admin
    .from("candidate_intakes")
    .update({ status: "needs_clarification" })
    .eq("id", intakeId);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "intake.needs_clarification",
    entityType: "candidate_intake",
    entityId: intakeId,
    metadata: { questionNo },
  });
  revalidatePath(`/nomzodlar/anketalar/${intakeId}`);
  return { ok: true };
}

/* --------------------------- promote & publish --------------------------- */

export async function promoteIntakeAction(intakeId: string): Promise<IntakeActionResult> {
  const ctx = await requirePermission("intakes.promote");
  const result = await promoteIntakeToDraft(intakeId, ctx.userId);
  revalidatePath(`/nomzodlar/anketalar/${intakeId}`);
  revalidatePath("/candidates");
  return result;
}

export async function publishIntakeAction(intakeId: string): Promise<IntakeActionResult> {
  const ctx = await requirePermission("intakes.publish");
  const result = await publishPromotedIntake(intakeId, ctx.userId);
  revalidatePath(`/nomzodlar/anketalar/${intakeId}`);
  revalidatePath("/candidates");
  return result;
}

/* --------------------------- photo selection --------------------------- */

export async function selectPhotoAction(
  intakeId: string,
  editId: string | null,
): Promise<IntakeActionResult> {
  const ctx = await requirePermission("intakes.edit");
  const admin = createSupabaseAdminClient();
  // Clear current selection, then set the chosen one (null = keep original).
  await admin
    .from("candidate_intake_photo_edits")
    .update({ is_selected: false })
    .eq("intake_id", intakeId)
    .eq("is_selected", true);
  if (editId) {
    const { error } = await admin
      .from("candidate_intake_photo_edits")
      .update({ is_selected: true })
      .eq("id", editId)
      .eq("intake_id", intakeId);
    if (error) return { ok: false, error: error.message };
  }
  await logAudit({
    actorId: ctx.userId,
    action: "intake.photo.select",
    entityType: "candidate_intake",
    entityId: intakeId,
    metadata: { editId: editId ?? "original" },
  });
  revalidatePath(`/nomzodlar/anketalar/${intakeId}`);
  return { ok: true };
}

export async function archiveIntakeAction(intakeId: string): Promise<IntakeActionResult> {
  const ctx = await requirePermission("intakes.edit");
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("candidate_intakes")
    .update({ deleted_at: new Date().toISOString(), status: "archived" })
    .eq("id", intakeId);
  if (error) return { ok: false, error: error.message };
  await logAudit({
    actorId: ctx.userId,
    action: "intake.archive",
    entityType: "candidate_intake",
    entityId: intakeId,
    severity: "warning",
  });
  revalidatePath("/nomzodlar/anketalar");
  return { ok: true };
}
