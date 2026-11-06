import { linkRequestSchema } from "@/lib/adabiyotx/partner-core";
import { partnerError, partnerJson, requireLiderlarApiKey } from "@/lib/adabiyotx/partner-auth";
import { linkAccounts } from "@/lib/adabiyotx/partner-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  TOKEN_INVALID: 404,
  TOKEN_EXPIRED: 410,
  TOKEN_USED: 410,
  ALREADY_LINKED_OTHER: 409,
  DB_ERROR: 500,
};

/**
 * POST /api/public/adabiyotx/link — AdabiyotX serveri a'zo skaner qilgan
 * tokenni (yoki qo'lda kiritgan kodni) o'z foydalanuvchisi bilan yuboradi.
 */
export async function POST(request: Request) {
  const denied = requireLiderlarApiKey(request);
  if (denied) return denied;

  const parsed = linkRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return partnerError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "So‘rov noto‘g‘ri.", 400);

  const outcome = await linkAccounts({ token: parsed.data.token, code: parsed.data.code, user: parsed.data.adabiyotx_user });
  if (!outcome.ok) return partnerError(outcome.code, outcome.error, STATUS[outcome.code] ?? 400);
  return partnerJson({ ok: true, link: outcome.link, already_linked: outcome.already });
}
