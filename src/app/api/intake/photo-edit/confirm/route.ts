import type { NextRequest } from "next/server";
import { extractRawToken, hashIntakeToken } from "@/lib/intake/tokens";
import { resolveActiveLink } from "@/lib/intake/data";
import { enforceRateLimit } from "@/lib/intake/rate-limit";
import { jsonError, noStoreJson, originAllowed, readJsonBody } from "@/lib/intake/http";
import { loadCandidatePhotoState } from "@/lib/intake/photo-jobs";
import { evaluatePhotoEditPrecheck, type ProcessedAttachmentRow } from "@/lib/intake/photo-confirm";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC_CONFIRM_MESSAGE = "Rasmni tasdiqlashda muammo yuz berdi. Qayta urinib ko‘ring.";

/** Safe, code-tagged failure response — the message shown to the candidate is
 * always generic; the specific code stays for logs/telemetry. */
function confirmFailure(status: number, code: string) {
  return noStoreJson({ ok: false, code, error: GENERIC_CONFIRM_MESSAGE }, status);
}

/** Atomically confirms either the primary original or one completed AI edit. */
export async function POST(request: NextRequest) {
  if (!originAllowed(request.headers)) return jsonError(403, "Ruxsat etilmagan manba");

  const body = await readJsonBody(request);
  const rawToken = extractRawToken(request.headers, body.token);
  if (!rawToken) return jsonError(400, "Havola topilmadi");

  const rateLimit = enforceRateLimit("photo_confirm", hashIntakeToken(rawToken));
  if (!rateLimit.ok) {
    return jsonError(429, "Juda ko‘p urinish", { retryAfterSeconds: rateLimit.retryAfterSeconds });
  }

  // Accept the canonical payload ({ source, photoEditId, originalAttachmentId })
  // and the legacy keys ({ kind, photo_edit_id, original_attachment_id }).
  const source = typeof body.source === "string" ? body.source : (body.kind as string | undefined);
  if (source !== "original" && source !== "ai") return jsonError(400, "Rasm tanlovi noto‘g‘ri");

  const photoEditId =
    typeof body.photoEditId === "string"
      ? body.photoEditId
      : typeof body.photo_edit_id === "string"
        ? body.photo_edit_id
        : null;
  if (source === "ai" && !photoEditId) return jsonError(400, "AI rasm topilmadi");

  const resolved = await resolveActiveLink(rawToken);
  if (!resolved) return jsonError(404, "Havola yaroqsiz yoki muddati tugagan");
  const intakeId = resolved.intakeId;

  const db = createSupabaseAdminClient();

  // ---- Original selection: resolve the primary photo's attachment id ----
  let originalAttachmentId: string | null = null;
  if (source === "original") {
    originalAttachmentId =
      (typeof body.originalAttachmentId === "string" && body.originalAttachmentId) ||
      (typeof body.original_attachment_id === "string" && body.original_attachment_id) ||
      null;
    if (!originalAttachmentId) {
      const { data: primary } = await db
        .from("candidate_intake_attachments")
        .select("id")
        .eq("intake_id", intakeId)
        .eq("is_primary_photo", true)
        .eq("status", "active")
        .maybeSingle();
      originalAttachmentId = (primary?.id as string) ?? null;
    }
    if (!originalAttachmentId) return confirmFailure(400, "PROCESSED_ATTACHMENT_MISSING");
  }

  // ---- AI selection: validate the real photo-edit row BEFORE the RPC ----
  if (source === "ai") {
    const { data: photoEdit } = await db
      .from("candidate_intake_photo_edits")
      .select("id, intake_id, status, processed_attachment_id, is_selected")
      .eq("id", photoEditId)
      .eq("intake_id", intakeId)
      .maybeSingle();

    let attachment: ProcessedAttachmentRow | null = null;
    if (photoEdit?.processed_attachment_id) {
      const { data: att } = await db
        .from("candidate_intake_attachments")
        .select("id, intake_id, kind, scan_status, mime_type, deleted_at")
        .eq("id", photoEdit.processed_attachment_id as string)
        .maybeSingle();
      attachment = (att as ProcessedAttachmentRow | null) ?? null;
    }

    const precheck = evaluatePhotoEditPrecheck({
      intakeId,
      photoEdit: photoEdit
        ? {
            intake_id: photoEdit.intake_id as string,
            status: photoEdit.status as string,
            processed_attachment_id: (photoEdit.processed_attachment_id as string | null) ?? null,
          }
        : null,
      attachment,
    });

    if (!precheck.ok) {
      console.error("PHOTO_CONFIRM_PRECHECK_FAILED", {
        photoEditExists: Boolean(photoEdit),
        status: photoEdit?.status ?? null,
        hasProcessedAttachment: Boolean(photoEdit?.processed_attachment_id),
        attachmentKind: attachment?.kind ?? null,
        attachmentScanStatus: attachment?.scan_status ?? null,
        attachmentDeleted: Boolean(attachment?.deleted_at),
      });
      return confirmFailure(precheck.status, precheck.code ?? "PHOTO_CONFIRMATION_FAILED");
    }
  }

  // ---- Authoritative confirmation via the RPC (real p_-prefixed signature) ----
  const rpcPayload = {
    p_intake_id: intakeId,
    p_source: source,
    p_original_attachment_id: source === "original" ? originalAttachmentId : null,
    p_photo_edit_id: source === "ai" ? photoEditId : null,
    p_actor: null,
  };

  const { data, error } = await db.rpc("confirm_candidate_intake_photo", rpcPayload);

  if (error) {
    // Safe diagnostics only — never log tokens, service key, signed URLs or image data.
    console.error(
      "PHOTO_CONFIRM_RPC_ERROR",
      JSON.stringify({
        code: error.code ?? null,
        message: error.message ?? null,
        details: error.details ?? null,
        hint: error.hint ?? null,
        source,
        intakeId,
        hasOriginalAttachmentId: Boolean(originalAttachmentId),
        hasPhotoEditId: Boolean(photoEditId),
      }),
    );
    return confirmFailure(400, "PHOTO_CONFIRMATION_FAILED");
  }

  // Supabase jsonb-returning function → data is the object itself (never data[0]).
  const result = data as { ok?: boolean; error?: string } | null;
  if (!result?.ok) {
    console.error("PHOTO_CONFIRM_RESULT_NOT_OK", { source, intakeId, resultError: result?.error ?? null });
    return confirmFailure(400, "PHOTO_CONFIRMATION_FAILED");
  }

  const photoEdit = await loadCandidatePhotoState(intakeId);
  return noStoreJson({
    ok: true,
    confirmation: {
      source,
      photoEditId: source === "ai" ? photoEditId : null,
      originalAttachmentId: source === "original" ? originalAttachmentId : null,
      confirmedAt: photoEdit.selection.confirmedAt ?? new Date().toISOString(),
    },
    photoEdit,
  });
}
