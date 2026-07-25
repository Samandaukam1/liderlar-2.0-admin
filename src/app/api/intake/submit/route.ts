import type { NextRequest } from "next/server";
import { extractRawToken, hashIntakeToken } from "@/lib/intake/tokens";
import { resolveActiveLink, getIntakeSettings } from "@/lib/intake/data";
import { validateContact } from "@/lib/intake/schemas";
import { enforceRateLimit } from "@/lib/intake/rate-limit";
import { clientIpHash, jsonError, noStoreJson, originAllowed, readJsonBody } from "@/lib/intake/http";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** POST /api/intake/submit — save final contact/consent then run the validation RPC. */
export async function POST(request: NextRequest) {
  if (!originAllowed(request.headers)) return jsonError(403, "Ruxsat etilmagan manba");

  const body = await readJsonBody(request);
  const rawToken = extractRawToken(request.headers, body.token);
  if (!rawToken) return jsonError(400, "Havola topilmadi");

  const rl = enforceRateLimit("submit", hashIntakeToken(rawToken));
  if (!rl.ok) return jsonError(429, "Juda ko‘p urinish", { retryAfterSeconds: rl.retryAfterSeconds });

  const contact = validateContact({
    phone: String(body.phone ?? ""),
    telegram: String(body.telegram ?? ""),
    consent: body.consent === true,
  });
  if (!contact.ok) return noStoreJson({ ok: false, errors: contact.errors }, 422);

  const resolved = await resolveActiveLink(rawToken);
  if (!resolved) return jsonError(404, "Havola yaroqsiz yoki muddati tugagan");

  const admin = createSupabaseAdminClient();
  const settings = await getIntakeSettings();

  await admin
    .from("candidate_intakes")
    .update({
      phone_e164: contact.phone,
      telegram_username: contact.telegram,
      consent_given: true,
      consent_text_version: settings.consentVersion,
      consent_at: new Date().toISOString(),
      consent_ip_hash: clientIpHash(request.headers),
    })
    .eq("id", resolved.intakeId);

  const { data: result, error } = await admin.rpc("submit_candidate_intake", {
    p_intake: resolved.intakeId,
    p_actor: null,
  });
  if (error) return jsonError(500, "Yuborishda xatolik yuz berdi");

  const res = result as { ok: boolean; errors?: string[] };
  if (!res?.ok) return noStoreJson({ ok: false, errors: res?.errors ?? ["Yuborib bo‘lmadi"] }, 422);

  // A successful (re-)submission resolves any candidate-visible AI feedback.
  await admin
    .from("candidate_intake_ai_feedback")
    .update({ is_resolved: true })
    .eq("intake_id", resolved.intakeId)
    .eq("is_resolved", false);

  return noStoreJson({ ok: true });
}
