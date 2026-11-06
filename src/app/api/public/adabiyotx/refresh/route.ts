import { unlinkByUserSchema } from "@/lib/adabiyotx/partner-core";
import { partnerError, partnerJson, requireLiderlarApiKey } from "@/lib/adabiyotx/partner-auth";
import { pullLibraryFromAdabiyotX } from "@/lib/adabiyotx/partner-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/public/adabiyotx/refresh — kabinetdan "Yangilash": AdabiyotX kutubxonasini tortadi. */
export async function POST(request: Request) {
  const denied = requireLiderlarApiKey(request);
  if (denied) return denied;
  const parsed = unlinkByUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return partnerError("VALIDATION_ERROR", "liderlar_user_id UUID bo‘lishi kerak.", 400);
  const result = await pullLibraryFromAdabiyotX(parsed.data.liderlar_user_id);
  if (!result.ok) return partnerError("REFRESH_FAILED", result.error, 502);
  return partnerJson({ ok: true, works: result.works, reads: result.reads });
}
