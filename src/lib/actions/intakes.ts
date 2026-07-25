"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { slugify } from "@/lib/utils";
import { nameSchema, composeFullName, validateContact } from "@/lib/intake/schemas";
import {
  generateRawIntakeToken,
  hashIntakeToken,
  tokenPrefix,
  buildIntakeLink,
} from "@/lib/intake/tokens";
import { getActiveTemplate, getIntakeSettings } from "@/lib/intake/data";
import { saveIntakeAnswer } from "@/lib/intake/answers";
import { copyFinalPhotoToAvatar } from "@/lib/intake/promote";
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

function parseNames(formData: FormData) {
  return nameSchema.safeParse({
    first_name: String(formData.get("first_name") ?? ""),
    last_name: String(formData.get("last_name") ?? ""),
    father_name: String(formData.get("father_name") ?? ""),
  });
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
  return { ok: true as const, link: buildIntakeLink(raw), prefix: tokenPrefix(raw), expiresAt };
}

/* --------------------------- create --------------------------- */

async function createIntake(
  formData: FormData,
  method: "manual" | "secure_link",
): Promise<IntakeActionResult> {
  const ctx = await requirePermission("intakes.create");
  const names = parseNames(formData);
  if (!names.success) return { ok: false, error: names.error.issues[0]?.message ?? "Ism xato" };

  const template = await getActiveTemplate();
  if (!template) return { ok: false, error: "Faol anketa shabloni topilmadi (migration/seed?)" };

  const admin = createSupabaseAdminClient();
  const fullName = composeFullName(names.data);
  const { data, error } = await admin
    .from("candidate_intakes")
    .insert({
      template_id: template.id,
      intake_method: method,
      status: "draft",
      first_name: names.data.first_name,
      last_name: names.data.last_name,
      father_name: names.data.father_name,
      full_name: fullName,
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
    newValue: { full_name: fullName, method },
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
  const admin = createSupabaseAdminClient();

  const { data: intake } = await admin
    .from("candidate_intakes")
    .select("full_name, status")
    .eq("id", intakeId)
    .maybeSingle();
  if (!intake) return { ok: false, error: "Anketa topilmadi" };
  if (intake.status !== "approved") {
    return { ok: false, error: "Avval anketani tasdiqlang (approved)" };
  }

  const avatarUrl = await copyFinalPhotoToAvatar(intakeId);
  const slug = slugify(intake.full_name as string);

  const { data, error } = await admin.rpc("promote_candidate_intake", {
    p_intake: intakeId,
    p_actor: ctx.userId,
    p_publish: false,
    p_avatar_url: avatarUrl,
    p_slug: slug,
  });
  if (error) return { ok: false, error: error.message };
  const res = data as { candidate_id: string; article_id: string; candidate_slug: string };

  revalidatePath(`/nomzodlar/anketalar/${intakeId}`);
  revalidatePath("/candidates");
  return { ok: true, candidateId: res.candidate_id, articleId: res.article_id, slug: res.candidate_slug };
}

export async function publishIntakeAction(intakeId: string): Promise<IntakeActionResult> {
  const ctx = await requirePermission("intakes.publish");
  const admin = createSupabaseAdminClient();

  const { data: intake } = await admin
    .from("candidate_intakes")
    .select("full_name, status, phone_e164, consent_given")
    .eq("id", intakeId)
    .maybeSingle();
  if (!intake) return { ok: false, error: "Anketa topilmadi" };
  if (!["approved", "promoted"].includes(intake.status as string)) {
    return { ok: false, error: "Nashr etish uchun anketa tasdiqlangan bo‘lishi kerak" };
  }
  if (!intake.consent_given) return { ok: false, error: "Rozilik tasdiqlanmagan — nashr etib bo‘lmaydi" };

  const avatarUrl = await copyFinalPhotoToAvatar(intakeId);
  if (!avatarUrl) return { ok: false, error: "Yakuniy portret rasm tanlanmagan" };
  const slug = slugify(intake.full_name as string);

  const { data, error } = await admin.rpc("promote_candidate_intake", {
    p_intake: intakeId,
    p_actor: ctx.userId,
    p_publish: true,
    p_avatar_url: avatarUrl,
    p_slug: slug,
  });
  if (error) return { ok: false, error: error.message };
  const res = data as { candidate_id: string; article_id: string; candidate_slug: string };

  revalidatePath(`/nomzodlar/anketalar/${intakeId}`);
  revalidatePath("/candidates");
  return { ok: true, candidateId: res.candidate_id, articleId: res.article_id, slug: res.candidate_slug };
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
