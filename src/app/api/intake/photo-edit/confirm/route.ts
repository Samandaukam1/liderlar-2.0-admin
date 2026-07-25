import type { NextRequest } from "next/server";
import { extractRawToken, hashIntakeToken } from "@/lib/intake/tokens";
import { resolveActiveLink } from "@/lib/intake/data";
import { enforceRateLimit } from "@/lib/intake/rate-limit";
import { jsonError, noStoreJson, originAllowed, readJsonBody } from "@/lib/intake/http";
import { loadCandidatePhotoState } from "@/lib/intake/photo-jobs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Atomically confirms either the primary original or one completed AI edit. */
export async function POST(request: NextRequest) {
  if (!originAllowed(request.headers)) return jsonError(403, "Ruxsat etilmagan manba");

  const body = await readJsonBody(request);
  const rawToken = extractRawToken(request.headers, body.token);
  if (!rawToken) return jsonError(400, "Havola topilmadi");

  const rateLimit = enforceRateLimit("photo_confirm", hashIntakeToken(rawToken));
  if (!rateLimit.ok) {
    return jsonError(429, "Juda ko‘p urinish", {
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
  }

  const kind = body.kind;
  if (kind !== "original" && kind !== "ai") return jsonError(400, "Rasm tanlovi noto‘g‘ri");
  const editId = typeof body.photo_edit_id === "string" ? body.photo_edit_id : null;
  if (kind === "ai" && !editId) return jsonError(400, "AI rasm topilmadi");

  const resolved = await resolveActiveLink(rawToken);
  if (!resolved) return jsonError(404, "Havola yaroqsiz yoki muddati tugagan");

  const db = createSupabaseAdminClient();

  // The original selection needs the primary photo's attachment id for the RPC.
  let originalAttachmentId: string | null = null;
  if (kind === "original") {
    originalAttachmentId =
      (typeof body.original_attachment_id === "string" && body.original_attachment_id) || null;
    if (!originalAttachmentId) {
      const { data: primary } = await db
        .from("candidate_intake_attachments")
        .select("id")
        .eq("intake_id", resolved.intakeId)
        .eq("is_primary_photo", true)
        .eq("status", "active")
        .maybeSingle();
      originalAttachmentId = (primary?.id as string) ?? null;
    }
    if (!originalAttachmentId) return jsonError(400, "Original rasm topilmadi");
  }

  // Call the RPC with its REAL signature — every argument is p_-prefixed and
  // matches confirm_candidate_intake_photo(p_intake_id, p_source,
  // p_original_attachment_id, p_photo_edit_id, p_actor). Sending non-prefixed
  // keys makes PostgREST fail to resolve the overload (PGRST202 → 404).
  const { data, error } = await db.rpc("confirm_candidate_intake_photo", {
    p_intake_id: resolved.intakeId,
    p_source: kind,
    p_original_attachment_id: kind === "original" ? originalAttachmentId : null,
    p_photo_edit_id: kind === "ai" ? editId : null,
    p_actor: null,
  });

  if (error) {
    // Safe diagnostics only — no tokens, no service key.
    console.error("PHOTO_CONFIRM_RPC_ERROR", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    // PGRST202 = function/overload not found in schema cache. The real message
    // stays in the server log; the candidate gets a generic message.
    return jsonError(500, "Rasmni tasdiqlab bo‘lmadi");
  }

  const result = data as { ok?: boolean; error?: string } | null;
  if (!result?.ok) return jsonError(422, result?.error ?? "Rasmni tasdiqlab bo‘lmadi");

  return noStoreJson({
    ok: true,
    photoEdit: await loadCandidatePhotoState(resolved.intakeId),
  });
}
