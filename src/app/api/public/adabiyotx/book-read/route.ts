import { bookReadSchema } from "@/lib/adabiyotx/partner-core";
import { partnerError, partnerJson, requireLiderlarApiKey } from "@/lib/adabiyotx/partner-auth";
import { recordBookRead } from "@/lib/adabiyotx/partner-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/public/adabiyotx/book-read — kitob testi topshirildi.
 * Ball = to'g'ri javoblar soni; kitob biografiyadagi "O'qigan kitoblari"ga tushadi.
 */
export async function POST(request: Request) {
  const denied = requireLiderlarApiKey(request);
  if (denied) return denied;
  const parsed = bookReadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return partnerError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "So‘rov noto‘g‘ri.", 400);
  try {
    const outcome = await recordBookRead(parsed.data);
    return partnerJson({ ok: true, ...outcome });
  } catch (error) {
    return partnerError("SAVE_FAILED", error instanceof Error ? error.message : "Saqlanmadi.", 500);
  }
}
