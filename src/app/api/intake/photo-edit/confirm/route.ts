import type { NextRequest } from "next/server";
import { extractRawToken, hashIntakeToken } from "@/lib/intake/tokens";
import { resolveActiveLink } from "@/lib/intake/data";
import { enforceRateLimit } from "@/lib/intake/rate-limit";
import { jsonError, noStoreJson, originAllowed, readJsonBody } from "@/lib/intake/http";
import {
  loadCandidatePhotoState,
  type CandidatePhotoSelectionKind,
} from "@/lib/intake/photo-jobs";
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
  const { data, error } = await db.rpc("confirm_candidate_intake_photo", {
    p_intake: resolved.intakeId,
    p_kind: kind as CandidatePhotoSelectionKind,
    p_edit: kind === "ai" ? editId : null,
  });
  if (error) return jsonError(500, "Rasmni tasdiqlab bo‘lmadi");

  const result = data as { ok?: boolean; error?: string } | null;
  if (!result?.ok) return jsonError(422, result?.error ?? "Rasmni tasdiqlab bo‘lmadi");

  return noStoreJson({
    ok: true,
    photoEdit: await loadCandidatePhotoState(resolved.intakeId),
  });
}
