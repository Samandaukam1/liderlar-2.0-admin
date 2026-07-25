import type { NextRequest } from "next/server";
import { extractRawToken, hashIntakeToken } from "@/lib/intake/tokens";
import { resolveActiveLink } from "@/lib/intake/data";
import { enforceRateLimit } from "@/lib/intake/rate-limit";
import { jsonError, noStoreJson } from "@/lib/intake/http";
import { loadCandidatePhotoState } from "@/lib/intake/photo-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Token-gated status for the requesting candidate's intake only. */
export async function GET(request: NextRequest) {
  const rawToken = extractRawToken(request.headers);
  if (!rawToken) return jsonError(400, "Havola topilmadi");

  const rateLimit = enforceRateLimit("photo_status", hashIntakeToken(rawToken));
  if (!rateLimit.ok) {
    return jsonError(429, "Holat juda tez-tez tekshirildi", {
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
  }

  const resolved = await resolveActiveLink(rawToken);
  if (!resolved) return jsonError(404, "Havola yaroqsiz yoki muddati tugagan");

  return noStoreJson({
    ok: true,
    photoEdit: await loadCandidatePhotoState(resolved.intakeId),
  });
}
