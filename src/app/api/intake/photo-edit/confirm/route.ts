import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { extractRawToken, hashIntakeToken } from "@/lib/intake/tokens";
import { resolveActiveLink } from "@/lib/intake/data";
import { enforceRateLimit } from "@/lib/intake/rate-limit";
import { noStoreJson, originAllowed } from "@/lib/intake/http";
import { loadCandidatePhotoState } from "@/lib/intake/photo-jobs";
import { evaluatePhotoEditPrecheck, type ProcessedAttachmentRow } from "@/lib/intake/photo-confirm";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC_CONFIRM_MESSAGE = "Rasmni tasdiqlashda muammo yuz berdi. Qayta urinib ko‘ring.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stage(traceId: string, name: string) {
  console.info("PHOTO_CONFIRM_STAGE", JSON.stringify({ traceId, stage: name }));
}

/** Code-tagged failure — the candidate sees a generic message; code/traceId are for logs. */
function fail(status: number, code: string, traceId: string, message = GENERIC_CONFIRM_MESSAGE) {
  return noStoreJson({ ok: false, code, error: message, traceId }, status);
}

/**
 * POST /api/intake/photo-edit/confirm
 * Confirms the primary original OR one completed AI edit for a candidate intake.
 * Every non-Supabase failure returns 400 (never 404), so a real 404 can only
 * come from a genuinely missing link/intake row.
 */
export async function POST(request: NextRequest) {
  const traceId = crypto.randomUUID();
  console.info(
    "PHOTO_CONFIRM_ROUTE_ENTERED",
    JSON.stringify({ traceId, method: request.method, pathname: new URL(request.url).pathname }),
  );

  if (!originAllowed(request.headers)) return fail(403, "ORIGIN_NOT_ALLOWED", traceId, "Ruxsat etilmagan manba");

  // ---- parse_body ----
  stage(traceId, "parse_body");
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    console.warn("PHOTO_CONFIRM_INVALID_JSON", JSON.stringify({ traceId }));
    return fail(400, "INVALID_JSON", traceId, "So‘rov ma’lumoti noto‘g‘ri yuborildi.");
  }

  // ---- validate_body ----
  stage(traceId, "validate_body");
  const rawToken = extractRawToken(request.headers, body.token);
  const source = typeof body.source === "string" ? body.source : (body.kind as string | undefined);
  const photoEditId =
    (typeof body.photoEditId === "string" && body.photoEditId) ||
    (typeof body.photo_edit_id === "string" && body.photo_edit_id) ||
    null;
  const bodyOriginalAttachmentId =
    (typeof body.originalAttachmentId === "string" && body.originalAttachmentId) ||
    (typeof body.original_attachment_id === "string" && body.original_attachment_id) ||
    null;

  console.info(
    "PHOTO_CONFIRM_REQUEST_VALIDATION",
    JSON.stringify({
      traceId,
      hasToken: Boolean(rawToken),
      source: source === "ai" || source === "original" ? source : null,
      hasPhotoEditId: Boolean(photoEditId),
      hasOriginalAttachmentId: Boolean(bodyOriginalAttachmentId),
    }),
  );

  // All pre-Supabase validation failures are 400 (never 404).
  if (!rawToken) return fail(400, "TOKEN_REQUIRED", traceId, "Maxsus anketa havolasi aniqlanmadi.");
  if (source !== "ai" && source !== "original") return fail(400, "INVALID_SOURCE", traceId);
  if (source === "ai") {
    if (!photoEditId) return fail(400, "PHOTO_EDIT_ID_REQUIRED", traceId, "Tasdiqlanadigan AI rasmi aniqlanmadi.");
    if (!UUID_RE.test(photoEditId)) return fail(400, "PHOTO_EDIT_ID_INVALID", traceId);
  }
  if (source === "original" && bodyOriginalAttachmentId && !UUID_RE.test(bodyOriginalAttachmentId)) {
    return fail(400, "ORIGINAL_ATTACHMENT_ID_INVALID", traceId);
  }

  const rateLimit = enforceRateLimit("photo_confirm", hashIntakeToken(rawToken));
  if (!rateLimit.ok) {
    return noStoreJson(
      { ok: false, code: "RATE_LIMITED", error: "Juda ko‘p urinish", traceId, retryAfterSeconds: rateLimit.retryAfterSeconds },
      429,
    );
  }

  // ---- verify_link (first Supabase call) ----
  stage(traceId, "verify_link");
  const resolved = await resolveActiveLink(rawToken);
  if (!resolved) return fail(404, "LINK_NOT_FOUND", traceId, "Havola yaroqsiz yoki muddati tugagan");
  const intakeId = resolved.intakeId;

  const db = createSupabaseAdminClient();

  // ---- load_intake / resolve original attachment ----
  stage(traceId, "load_intake");
  let originalAttachmentId: string | null = bodyOriginalAttachmentId;
  if (source === "original") {
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
    if (!originalAttachmentId) return fail(404, "PRIMARY_PHOTO_NOT_FOUND", traceId);
  }

  // ---- validate_photo (AI precheck) ----
  if (source === "ai") {
    stage(traceId, "validate_photo");
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
      console.error(
        "PHOTO_CONFIRM_PRECHECK_FAILED",
        JSON.stringify({
          traceId,
          photoEditExists: Boolean(photoEdit),
          status: photoEdit?.status ?? null,
          hasProcessedAttachment: Boolean(photoEdit?.processed_attachment_id),
          attachmentKind: attachment?.kind ?? null,
          attachmentScanStatus: attachment?.scan_status ?? null,
          attachmentDeleted: Boolean(attachment?.deleted_at),
        }),
      );
      return fail(precheck.status, precheck.code ?? "PHOTO_CONFIRMATION_FAILED", traceId);
    }
  }

  // ---- call_confirmation_rpc ----
  stage(traceId, "call_confirmation_rpc");
  const rpcPayload = {
    p_intake_id: intakeId,
    p_source: source,
    p_original_attachment_id: source === "original" ? originalAttachmentId : null,
    p_photo_edit_id: source === "ai" ? photoEditId : null,
    p_actor: null,
  };
  const { data, error } = await db.rpc("confirm_candidate_intake_photo", rpcPayload);

  if (error) {
    console.error(
      "PHOTO_CONFIRM_RPC_ERROR",
      JSON.stringify({
        traceId,
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
    return fail(400, "PHOTO_CONFIRMATION_FAILED", traceId);
  }

  // Supabase jsonb-returning function → data is the object itself (never data[0]).
  const result = data as
    | { ok?: boolean; source?: string; photo_edit_id?: string; original_attachment_id?: string; confirmed_at?: string; error?: string }
    | null;
  if (result && result.ok === false) {
    console.error("PHOTO_CONFIRM_RESULT_NOT_OK", JSON.stringify({ traceId, source, intakeId, resultError: result?.error ?? null }));
    return fail(400, "PHOTO_CONFIRMATION_FAILED", traceId);
  }

  // ---- completed ----
  stage(traceId, "completed");
  const photoEdit = await loadCandidatePhotoState(intakeId);
  return noStoreJson(
    {
      ok: true,
      traceId,
      confirmation: {
        source: result?.source ?? source,
        photoEditId: result?.photo_edit_id ?? (source === "ai" ? photoEditId : null),
        originalAttachmentId: result?.original_attachment_id ?? (source === "original" ? originalAttachmentId : null),
        confirmedAt: result?.confirmed_at ?? photoEdit.selection.confirmedAt ?? new Date().toISOString(),
      },
      photoEdit,
    },
    200,
  );
}
