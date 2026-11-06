import { unlinkByUserSchema } from "@/lib/adabiyotx/partner-core";
import { partnerError, partnerJson, requireLiderlarApiKey } from "@/lib/adabiyotx/partner-auth";
import { notifyAdabiyotXUnlink, unlinkByLiderlarUser } from "@/lib/adabiyotx/partner-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/public/adabiyotx/unlink-by-user — liderlar-web kabinetidan "uzish".
 * Bu yerda o'chiriladi va AdabiyotX'ga ham xabar beriladi (eng yaxshi harakat).
 */
export async function POST(request: Request) {
  const denied = requireLiderlarApiKey(request);
  if (denied) return denied;
  const parsed = unlinkByUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return partnerError("VALIDATION_ERROR", "liderlar_user_id UUID bo‘lishi kerak.", 400);
  const result = await unlinkByLiderlarUser(parsed.data.liderlar_user_id);
  const notified = result.adabiyotxUserId ? await notifyAdabiyotXUnlink(result.adabiyotxUserId) : false;
  return partnerJson({ ok: true, found: result.found, notified });
}
