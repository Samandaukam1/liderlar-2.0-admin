import { unlinkRequestSchema } from "@/lib/adabiyotx/partner-core";
import { partnerError, partnerJson, requireLiderlarApiKey } from "@/lib/adabiyotx/partner-auth";
import { unlinkByAdabiyotXUser } from "@/lib/adabiyotx/partner-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/public/adabiyotx/unlink — ilovadan "uzish". */
export async function POST(request: Request) {
  const denied = requireLiderlarApiKey(request);
  if (denied) return denied;
  const parsed = unlinkRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return partnerError("VALIDATION_ERROR", "adabiyotx_user_id UUID bo‘lishi kerak.", 400);
  const result = await unlinkByAdabiyotXUser(parsed.data.adabiyotx_user_id);
  return partnerJson({ ok: true, found: result.found });
}
