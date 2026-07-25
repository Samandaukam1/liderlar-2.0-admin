import type { NextRequest } from "next/server";
import { extractRawToken, hashIntakeToken } from "@/lib/intake/tokens";
import { resolveActiveLink } from "@/lib/intake/data";
import { enforceRateLimit } from "@/lib/intake/rate-limit";
import { jsonError, noStoreJson, readJsonBody } from "@/lib/intake/http";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** POST /api/intake/heartbeat — keep-alive / presence ping (sendBeacon-friendly). */
export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  const rawToken = extractRawToken(request.headers, body.token);
  if (!rawToken) return jsonError(400, "Havola topilmadi");

  const rl = enforceRateLimit("heartbeat", hashIntakeToken(rawToken));
  if (!rl.ok) return jsonError(429, "Juda tez");

  const resolved = await resolveActiveLink(rawToken);
  if (!resolved) return jsonError(404, "Havola yaroqsiz");

  const admin = createSupabaseAdminClient();
  await admin
    .from("candidate_intakes")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", resolved.intakeId);

  return noStoreJson({ ok: true });
}
