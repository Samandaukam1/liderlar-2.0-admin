/** Pure JSON boundary for the public intake upload response. */

export interface PublicUploadAttachmentRow {
  id: unknown;
  intake_id: unknown;
  file_name: unknown;
  mime_type: unknown;
  size_bytes: unknown;
  kind: unknown;
  created_at: unknown;
}

export function jsonSafeSizeBytes(value: unknown): number | string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value;
  return 0;
}

export async function bestEffortPreviewUrl(
  createSignedUrl: () => Promise<string | null>,
): Promise<string | null> {
  try {
    return await createSignedUrl();
  } catch {
    return null;
  }
}

export function normalizeUploadRequestId(value: unknown, fallback: string): string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : fallback;
}

export function uploadDedupTarget(
  purpose: "photo" | "attachment",
  answerId: string | null,
): { field: "is_primary_photo"; value: true } | { field: "answer_id"; value: string } {
  return purpose === "photo"
    ? { field: "is_primary_photo", value: true }
    : { field: "answer_id", value: answerId ?? "" };
}

export function buildIntakeUploadPath(input: {
  intakeId: string;
  scope: string;
  requestId: string;
  extension: string;
}): string {
  return `${input.intakeId}/${input.scope}/${input.requestId}.${input.extension}`;
}

export function serializePublicUploadAttachment(row: PublicUploadAttachmentRow) {
  return {
    id: String(row.id),
    intakeId: String(row.intake_id),
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    sizeBytes: jsonSafeSizeBytes(row.size_bytes),
    kind: String(row.kind),
    createdAt: String(row.created_at),
  };
}
