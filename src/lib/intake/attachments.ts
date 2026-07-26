import "server-only";
import { createHash } from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { INTAKE_BUCKET } from "./constants";
import { PHOTO_MIME, sanitizeFileName, validateIntakeUpload } from "./files";
import { signIntakeFileUrl } from "./data";
import {
  bestEffortPreviewUrl,
  buildIntakeUploadPath,
  uploadDedupTarget,
} from "./upload-response";

export interface UploadedAttachment {
  id: string;
  intake_id: string;
  file_name: string;
  mime_type: string;
  kind: string;
  size_bytes: number | string;
  created_at: string;
  is_primary_photo: boolean;
  question_no: number | null;
  signedUrl: string | null;
}

export type UploadOutcome =
  | { ok: true; attachment: UploadedAttachment }
  | { ok: false; error: string; status?: number };

export type IntakeUploadStage =
  | "validate_file"
  | "upload_storage"
  | "insert_attachment"
  | "build_response";

interface AttachmentRow {
  id: string;
  intake_id: string;
  bucket: string;
  path: string;
  file_name: string;
  mime_type: string;
  size_bytes: unknown;
  kind: string;
  created_at: string;
}

const ATTACHMENT_SELECT =
  "id, intake_id, bucket, path, file_name, mime_type, size_bytes, kind, created_at";

async function safeSignedUrl(path: string): Promise<string | null> {
  return bestEffortPreviewUrl(() => signIntakeFileUrl(path, 3600));
}

async function toUploadedAttachment(
  row: AttachmentRow,
  params: {
    purpose: "photo" | "attachment";
    questionNo?: number | null;
  },
): Promise<UploadedAttachment> {
  return {
    id: row.id,
    intake_id: row.intake_id,
    file_name: row.file_name,
    mime_type: row.mime_type,
    kind: row.kind,
    size_bytes:
      typeof row.size_bytes === "bigint"
        ? row.size_bytes.toString()
        : typeof row.size_bytes === "number"
          ? row.size_bytes
          : String(row.size_bytes),
    created_at: row.created_at,
    is_primary_photo: params.purpose === "photo",
    question_no: params.questionNo ?? null,
    signedUrl: await safeSignedUrl(row.path),
  };
}

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
  requestId?: string;
  onStage?: (stage: IntakeUploadStage) => void;
}): Promise<UploadOutcome> {
  const admin = createSupabaseAdminClient();

  params.onStage?.("validate_file");
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
  const objectId = params.requestId ?? crypto.randomUUID();
  const path = buildIntakeUploadPath({
    intakeId: params.intakeId,
    scope: String(scope),
    requestId: objectId,
    extension: check.ext!,
  });
  const checksum = createHash("sha256").update(params.bytes).digest("hex");

  // Retry/idempotency guard: the same active bytes for the same logical target
  // reuse the canonical attachment instead of creating another object/row.
  let duplicateQuery = admin
    .from("candidate_intake_attachments")
    .select(ATTACHMENT_SELECT)
    .eq("intake_id", params.intakeId)
    .eq("checksum_sha256", checksum)
    .eq("status", "active");
  const dedupTarget = uploadDedupTarget(params.purpose, answerId);
  duplicateQuery = duplicateQuery.eq(dedupTarget.field, dedupTarget.value);
  const { data: duplicate } = await duplicateQuery
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (duplicate?.id) {
    params.onStage?.("build_response");
    return {
      ok: true,
      attachment: await toUploadedAttachment(duplicate as AttachmentRow, params),
    };
  }

  params.onStage?.("upload_storage");
  const { error: uploadError } = await admin.storage
    .from(INTAKE_BUCKET)
    .upload(path, Buffer.from(params.bytes), { contentType: check.mime, upsert: false });
  if (uploadError) {
    // The same request ID may have completed after the initial response was
    // lost. Resolve its deterministic path before treating it as a failure.
    const { data: existingByPath } = await admin
      .from("candidate_intake_attachments")
      .select(ATTACHMENT_SELECT)
      .eq("bucket", INTAKE_BUCKET)
      .eq("path", path)
      .maybeSingle();
    if (existingByPath?.id) {
      params.onStage?.("build_response");
      return {
        ok: true,
        attachment: await toUploadedAttachment(existingByPath as AttachmentRow, params),
      };
    }
    const duplicateObject = /already exists|duplicate|resource exists/i.test(uploadError.message);
    return {
      ok: false,
      error: duplicateObject
        ? "Yuklash yakunlanmoqda. Qayta urinib ko‘ring."
        : uploadError.message,
      status: duplicateObject ? 409 : 500,
    };
  }

  // The canonical partial unique index allows only one active primary photo,
  // so retire the previous one immediately before inserting its replacement.
  if (params.purpose === "photo") {
    await admin
      .from("candidate_intake_attachments")
      .update({ status: "deleted", deleted_at: new Date().toISOString(), is_primary_photo: false })
      .eq("intake_id", params.intakeId)
      .eq("is_primary_photo", true)
      .eq("status", "active");
  }

  const safeFileName = sanitizeFileName(params.originalName);
  params.onStage?.("insert_attachment");
  const { data: row, error: attachmentError } = await admin
    .from("candidate_intake_attachments")
    .insert({
      intake_id: params.intakeId,
      answer_id: answerId,
      bucket: INTAKE_BUCKET,
      path,
      file_name: safeFileName,
      mime_type: check.mime,
      size_bytes: params.bytes.byteLength,
      checksum_sha256: checksum,
      kind: params.purpose === "photo" ? "photo" : check.kind,
      is_primary_photo: params.purpose === "photo",
      uploaded_by: params.uploadedBy ?? null,
    })
    .select(ATTACHMENT_SELECT)
    .single();
  if (attachmentError) {
    // best-effort cleanup of the orphaned object
    await admin.storage.from(INTAKE_BUCKET).remove([path]).catch(() => {});
    throw new Error(`Attachment insert failed: ${attachmentError.message}`);
  }
  if (!row?.id) {
    // Do not remove the object here: PostgREST reported no insert error, so a
    // durable attachment row may exist even though its representation is lost.
    throw new Error("Attachment insert succeeded but no attachment row was returned");
  }

  if (params.purpose === "photo") {
    // Compatibility-safe best effort: deployments that have not applied the
    // photo-confirmation migration must not turn a successful upload into 500.
    await Promise.all([
      admin
        .from("candidate_intakes")
        .update({
          selected_photo_source: null,
          selected_original_attachment_id: null,
          selected_photo_edit_id: null,
          photo_confirmed_at: null,
          photo_confirmation_metadata: null,
        })
        .eq("id", params.intakeId),
      admin
        .from("candidate_intake_photo_edits")
        .update({ is_selected: false })
        .eq("intake_id", params.intakeId)
        .eq("is_selected", true),
    ]).catch(() => {
      // The durable attachment must remain successful even if this optional
      // compatibility cleanup cannot run.
    });
  }

  params.onStage?.("build_response");
  return {
    ok: true,
    attachment: await toUploadedAttachment(row as AttachmentRow, params),
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
