import { partnerError, partnerJson, requireLiderlarApiKey } from "@/lib/adabiyotx/partner-auth";
import { findLinkByAdabiyotXUser } from "@/lib/adabiyotx/partner-service";
import { uuidSchema } from "@/lib/adabiyotx/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/public/adabiyotx/status?adabiyotx_user_id=… — ilova uchun holat. */
export async function GET(request: Request) {
  const denied = requireLiderlarApiKey(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("adabiyotx_user_id") ?? "";
  if (!uuidSchema.safeParse(id).success) return partnerError("VALIDATION_ERROR", "adabiyotx_user_id UUID bo‘lishi kerak.", 400);
  const link = await findLinkByAdabiyotXUser(id);
  return partnerJson({ ok: true, linked: Boolean(link), link });
}
