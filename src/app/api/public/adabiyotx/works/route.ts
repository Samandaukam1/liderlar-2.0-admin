import { worksSchema } from "@/lib/adabiyotx/partner-core";
import { partnerError, partnerJson, requireLiderlarApiKey } from "@/lib/adabiyotx/partner-auth";
import { syncOwnWorks } from "@/lib/adabiyotx/partner-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/public/adabiyotx/works — a'zoning AdabiyotX'dagi o'z kitoblari. */
export async function POST(request: Request) {
  const denied = requireLiderlarApiKey(request);
  if (denied) return denied;
  const parsed = worksSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return partnerError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "So‘rov noto‘g‘ri.", 400);
  try {
    const result = await syncOwnWorks(parsed.data.adabiyotx_user_id, parsed.data.works);
    return partnerJson({ ok: true, ...result });
  } catch (error) {
    return partnerError("SAVE_FAILED", error instanceof Error ? error.message : "Saqlanmadi.", 500);
  }
}
