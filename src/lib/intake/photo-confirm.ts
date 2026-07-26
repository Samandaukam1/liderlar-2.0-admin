/**
 * Pure precheck for AI photo confirmation — no DB, no server-only, unit-tested.
 * Mirrors the validation the confirm RPC performs so the route can return a
 * specific, safe error code before hitting Postgres.
 */

export interface PhotoEditRow {
  intake_id: string;
  status: string;
  processed_attachment_id: string | null;
}

export interface ProcessedAttachmentRow {
  intake_id: string;
  kind: string | null;
  scan_status: string | null;
  deleted_at: string | null;
}

export type PhotoPrecheckCode =
  | "PHOTO_EDIT_NOT_FOUND"
  | "PHOTO_EDIT_NOT_COMPLETED"
  | "PROCESSED_ATTACHMENT_MISSING"
  | "INVALID_ATTACHMENT_KIND"
  | "ATTACHMENT_NOT_READY"
  | "PHOTO_CONFIRMATION_FAILED";

export interface PhotoPrecheckResult {
  ok: boolean;
  code: PhotoPrecheckCode | null;
  status: number;
}

export function evaluatePhotoEditPrecheck(params: {
  intakeId: string;
  photoEdit: PhotoEditRow | null;
  attachment: ProcessedAttachmentRow | null;
}): PhotoPrecheckResult {
  const { intakeId, photoEdit, attachment } = params;

  if (!photoEdit || photoEdit.intake_id !== intakeId) {
    return { ok: false, code: "PHOTO_EDIT_NOT_FOUND", status: 404 };
  }
  if (photoEdit.status !== "completed") {
    return { ok: false, code: "PHOTO_EDIT_NOT_COMPLETED", status: 409 };
  }
  if (!photoEdit.processed_attachment_id || !attachment) {
    return { ok: false, code: "PROCESSED_ATTACHMENT_MISSING", status: 400 };
  }
  if (attachment.intake_id !== intakeId || attachment.deleted_at) {
    return { ok: false, code: "PROCESSED_ATTACHMENT_MISSING", status: 400 };
  }
  if (attachment.kind !== "image") {
    return { ok: false, code: "INVALID_ATTACHMENT_KIND", status: 400 };
  }
  if (attachment.scan_status !== "ready") {
    return { ok: false, code: "ATTACHMENT_NOT_READY", status: 409 };
  }
  return { ok: true, code: null, status: 200 };
}
