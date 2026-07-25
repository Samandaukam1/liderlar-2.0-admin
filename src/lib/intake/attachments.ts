import "server-only";
import { createHash } from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { INTAKE_BUCKET } from "./constants";
import { PHOTO_MIME, sanitizeFileName, validateIntakeUpload } from "./files";
import { signIntakeFileUrl } from "./data";

export interface UploadedAttachment {
  id: string;
  file_name: string;
  mime_type: string;
  kind: string;
  size_bytes: number;
  is_primary_photo: boolean;
  question_no: number | null;
  signedUrl: string | null;
}

export type UploadOutcome =
  | { ok: true; attachment: UploadedAttachment }
  | { ok: false; error: string; status?: number };

/** Ensure an answer row exists for (intake, questionNo); returns its id. */
async function ensureAnswerRow(intakeId: string, questionNo: number): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data: intake } = await admin
    .from("candidate_intakes")
    .select("template_id")
    .eq("id", intakeId)
    .maybeSingle();
  if (!intake) return null;

  const { data: q } = await admin
    .from("candidate_intake_questions")
    .select("id")
    .eq("template_id", intake.template_id)
    .eq("question_no", questionNo)
    .maybeSingle();
  if (!q) return null;

  const { data: existing } = await admin
    .from("candidate_intake_answers")
    .select("id")
    .eq("intake_id", intakeId)
    .eq("question_id", q.id)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data: created } = await admin
    .from("candidate_intake_answers")
    .insert({ intake_id: intakeId, question_id: q.id, question_no: questionNo, answer_state: "unanswered" })
    .select("id")
    .single();
  return (created?.id as string) ?? null;
}

/**
 * The single server gate for every intake file. Verifies magic bytes, stores
 * the object under a random path in the private bucket (original name kept as
 * metadata only), and records candidate_intake_attachments. For the portrait
 * photo it enforces exactly one active primary.
 */
export async function uploadIntakeFile(params: {
  intakeId: string;
  bytes: Uint8Array;
  declaredMime: string;
  originalName: string;
  purpose: "photo" | "attachment";
  questionNo?: number | null;
  maxBytes: number;
  uploadedBy?: string | null;
}): Promise<UploadOutcome> {
  const admin = createSupabaseAdminClient();

  const check = validateIntakeUpload({
    bytes: params.bytes,
    declaredMime: params.declaredMime,
    size: params.bytes.byteLength,
    maxBytes: params.maxBytes,
  });
  if (!check.ok) return { ok: false, error: check.error ?? "Fayl rad etildi", status: 400 };

  if (params.purpose === "photo" && !PHOTO_MIME.has(check.mime!)) {
    return { ok: false, error: "Portret uchun faqat rasm (JPG/PNG/WEBP/HEIC) qabul qilinadi", status: 400 };
  }

  let answerId: string | null = null;
  if (params.purpose === "attachment") {
    if (!params.questionNo) return { ok: false, error: "Savol raqami ko‘rsatilmagan", status: 400 };
    answerId = await ensureAnswerRow(params.intakeId, params.questionNo);
    if (!answerId) return { ok: false, error: "Savol topilmadi", status: 400 };
  }

  const scope = params.purpose === "photo" ? "photos" : answerId;
  const path = `${params.intakeId}/${scope}/${crypto.randomUUID()}.${check.ext}`;
  const checksum = createHash("sha256").update(params.bytes).digest("hex");

  const { error: uploadError } = await admin.storage
    .from(INTAKE_BUCKET)
    .upload(path, Buffer.from(params.bytes), { contentType: check.mime, upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message, status: 500 };

  // Single active primary photo: retire the previous one first.
  if (params.purpose === "photo") {
    await admin
      .from("candidate_intake_attachments")
      .update({ status: "deleted", deleted_at: new Date().toISOString(), is_primary_photo: false })
      .eq("intake_id", params.intakeId)
      .eq("is_primary_photo", true)
      .eq("status", "active");
  }

  const { data: row, error } = await admin
    .from("candidate_intake_attachments")
    .insert({
      intake_id: params.intakeId,
      answer_id: answerId,
      bucket: INTAKE_BUCKET,
      path,
      file_name: sanitizeFileName(params.originalName),
      mime_type: check.mime,
      size_bytes: params.bytes.byteLength,
      checksum_sha256: checksum,
      kind: params.purpose === "photo" ? "photo" : check.kind,
      is_primary_photo: params.purpose === "photo",
      uploaded_by: params.uploadedBy ?? null,
    })
    .select("id")
    .single();
  if (error || !row) {
    // best-effort cleanup of the orphaned object
    await admin.storage.from(INTAKE_BUCKET).remove([path]).catch(() => {});
    return { ok: false, error: error?.message ?? "Saqlab bo‘lmadi", status: 500 };
  }

  if (params.purpose === "photo") {
    const [{ error: confirmationResetError }, { error: selectionResetError }] = await Promise.all([
      admin
        .from("candidate_intakes")
        .update({ selected_photo_kind: null, photo_confirmed_at: null })
        .eq("id", params.intakeId),
      admin
        .from("candidate_intake_photo_edits")
        .update({ is_selected: false })
        .eq("intake_id", params.intakeId)
        .eq("is_selected", true),
    ]);
    if (confirmationResetError || selectionResetError) {
      return {
        ok: false,
        error: "Yangi rasm tanlovini boshlashda xatolik yuz berdi",
        status: 500,
      };
    }
  }

  return {
    ok: true,
    attachment: {
      id: row.id as string,
      file_name: sanitizeFileName(params.originalName),
      mime_type: check.mime!,
      kind: params.purpose === "photo" ? "photo" : check.kind!,
      size_bytes: params.bytes.byteLength,
      is_primary_photo: params.purpose === "photo",
      question_no: params.questionNo ?? null,
      signedUrl: await signIntakeFileUrl(path, 3600),
    },
  };
}

/** Soft-delete an attachment (and queue storage cleanup). */
export async function softDeleteAttachment(intakeId: string, attachmentId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("candidate_intake_attachments")
    .update({ status: "deleted", deleted_at: new Date().toISOString() })
    .eq("id", attachmentId)
    .eq("intake_id", intakeId);
  return !error;
}
