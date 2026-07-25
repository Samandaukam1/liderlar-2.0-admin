import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashIntakeToken, timingSafeEqualHex } from "./tokens";
import {
  DEFAULT_MAX_UPLOAD_MB,
  DEFAULT_LINK_TTL_DAYS,
  INTAKE_BUCKET,
  SETTINGS_KEYS,
} from "./constants";

/* ----------------------------- settings ----------------------------- */

export interface IntakeSettings {
  defaultPhotoPrompt: string;
  femalePhotoPrompt: string;
  malePhotoPrompt: string;
  consentText: string;
  consentVersion: string;
  maxUploadBytes: number;
  linkTtlDays: number;
}

export async function getIntakeSettings(): Promise<IntakeSettings> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("site_settings")
    .select("key, value")
    .in("key", Object.values(SETTINGS_KEYS));

  const map = new Map((data ?? []).map((r) => [r.key as string, r.value as string]));
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  return {
    defaultPhotoPrompt: map.get(SETTINGS_KEYS.defaultPhotoPrompt) ?? "",
    femalePhotoPrompt: map.get(SETTINGS_KEYS.femalePhotoPrompt) ?? "",
    malePhotoPrompt: map.get(SETTINGS_KEYS.malePhotoPrompt) ?? "",
    consentText: map.get(SETTINGS_KEYS.consentText) ?? "",
    consentVersion: map.get(SETTINGS_KEYS.consentVersion) ?? "v1",
    maxUploadBytes: num(map.get(SETTINGS_KEYS.maxUploadMb), DEFAULT_MAX_UPLOAD_MB) * 1024 * 1024,
    linkTtlDays: num(map.get(SETTINGS_KEYS.linkTtlDays), DEFAULT_LINK_TTL_DAYS),
  };
}

/* ----------------------------- template ----------------------------- */

export interface IntakeQuestion {
  id: string;
  question_no: number;
  prompt: string;
  help_text: string | null;
  answer_type: string;
  is_required: boolean;
  allow_no_answer: boolean;
}

export interface IntakeTemplate {
  id: string;
  slug: string;
  name: string;
  intro_text: string;
  photo_stage_title: string;
  photo_stage_instruction: string;
  footer_text: string;
  questions: IntakeQuestion[];
}

export async function getActiveTemplate(): Promise<IntakeTemplate | null> {
  const admin = createSupabaseAdminClient();
  const { data: tpl } = await admin
    .from("candidate_intake_templates")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();
  if (!tpl) return null;

  const { data: questions } = await admin
    .from("candidate_intake_questions")
    .select("id, question_no, prompt, help_text, answer_type, is_required, allow_no_answer")
    .eq("template_id", tpl.id)
    .order("question_no");

  return { ...(tpl as Omit<IntakeTemplate, "questions">), questions: (questions ?? []) as IntakeQuestion[] };
}

/* ----------------------------- token resolution ----------------------------- */

export interface ResolvedLink {
  linkId: string;
  intakeId: string;
  expiresAt: string;
}

/**
 * Resolves a raw secure-link token to its intake. Returns null for unknown,
 * revoked or expired tokens. Expired-but-active rows are flipped to 'expired'.
 * The raw token is never logged or stored.
 */
export async function resolveActiveLink(rawToken: string): Promise<ResolvedLink | null> {
  const admin = createSupabaseAdminClient();
  const hash = hashIntakeToken(rawToken);

  const { data: link } = await admin
    .from("candidate_intake_links")
    .select("id, intake_id, token_hash, status, expires_at")
    .eq("token_hash", hash)
    .maybeSingle();

  if (!link) return null;
  // Defense-in-depth timing-safe check (lookup already used the exact hash).
  if (!timingSafeEqualHex(link.token_hash as string, hash)) return null;
  if (link.status !== "active") return null;

  if (new Date(link.expires_at as string).getTime() < Date.now()) {
    await admin.from("candidate_intake_links").update({ status: "expired" }).eq("id", link.id);
    return null;
  }

  // Only serve links whose intake is still open to editing.
  const { data: intake } = await admin
    .from("candidate_intakes")
    .select("id, status, deleted_at")
    .eq("id", link.intake_id)
    .maybeSingle();
  if (!intake || intake.deleted_at) return null;
  if (!["draft", "needs_clarification"].includes(intake.status as string)) return null;

  return {
    linkId: link.id as string,
    intakeId: link.intake_id as string,
    expiresAt: link.expires_at as string,
  };
}

/** Best-effort "link was used" marker. Never throws into the request path. */
export async function touchLinkUsage(linkId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("candidate_intake_links")
    .select("use_count")
    .eq("id", linkId)
    .maybeSingle();
  await admin
    .from("candidate_intake_links")
    .update({
      last_used_at: new Date().toISOString(),
      use_count: ((data?.use_count as number) ?? 0) + 1,
    })
    .eq("id", linkId);
}

/* ----------------------------- public state ----------------------------- */

export interface PublicAnswer {
  question_no: number;
  answer_state: string;
  rich_content: unknown;
  plain_text: string;
  lock_version: number;
}

export interface PublicIntakeState {
  intake: {
    id: string;
    status: string;
    full_name: string;
    gender: string | null;
    current_question_no: number;
    last_completed_question_no: number;
    phone_e164: string | null;
    telegram_username: string | null;
    consent_given: boolean;
  };
  template: IntakeTemplate;
  answers: PublicAnswer[];
  primaryPhoto: { path: string; file_name: string; signedUrl: string | null } | null;
  feedback: IntakeFeedback[];
}

export interface IntakeFeedback {
  question_no: number | null;
  feedback_text: string;
  feedback_type: string;
}

/** Everything the public form needs to render — no tokens, no service key. */
export async function loadPublicIntakeState(intakeId: string): Promise<PublicIntakeState | null> {
  const admin = createSupabaseAdminClient();
  const { data: intake } = await admin
    .from("candidate_intakes")
    .select(
      "id, status, full_name, gender, template_id, current_question_no, last_completed_question_no, phone_e164, telegram_username, consent_given",
    )
    .eq("id", intakeId)
    .maybeSingle();
  if (!intake) return null;

  const template = await getActiveTemplate();
  if (!template) return null;

  const [{ data: answers }, { data: photo }, { data: feedback }] = await Promise.all([
    admin
      .from("candidate_intake_answers")
      .select("question_no, answer_state, rich_content, plain_text, lock_version")
      .eq("intake_id", intakeId)
      .order("question_no"),
    admin
      .from("candidate_intake_attachments")
      .select("path, file_name")
      .eq("intake_id", intakeId)
      .eq("is_primary_photo", true)
      .eq("status", "active")
      .maybeSingle(),
    admin
      .from("candidate_intake_ai_feedback")
      .select("question_no, feedback_text, feedback_type")
      .eq("intake_id", intakeId)
      .eq("is_visible_to_candidate", true)
      .eq("is_resolved", false),
  ]);

  let primaryPhoto: PublicIntakeState["primaryPhoto"] = null;
  if (photo) {
    primaryPhoto = {
      path: photo.path as string,
      file_name: photo.file_name as string,
      signedUrl: await signIntakeFileUrl(photo.path as string, 3600),
    };
  }

  return {
    intake: intake as PublicIntakeState["intake"],
    template,
    answers: (answers ?? []) as PublicAnswer[],
    primaryPhoto,
    feedback: (feedback ?? []) as IntakeFeedback[],
  };
}

/* ----------------------------- storage ----------------------------- */

export async function signIntakeFileUrl(path: string, seconds = 3600): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.storage.from(INTAKE_BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}
