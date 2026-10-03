import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { sweepAdabiyotXChannels } from "@/lib/articles/adabiyotx-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/adabiyotx-sync
 *
 * Nashr qilingan maqolalarni AdabiyotX'ga uzatadi va yiqilganlarini
 * qayta uriniб ko'radi (§25, §73).
 *
 * FLAG OSTIDA: `vip.adabiyotx_sync_enabled` o'chiq bo'lsa, vazifa
 * hech narsa qilmaydi. Kanal qatorlari `pending` holatida saqlanib
 * turadi, ya'ni flag yoqilganda ularning hammasi uzatiladi va hech
 * bir nashr yo'qolmaydi.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET sozlanmagan — AdabiyotX uzatilmadi");
    return NextResponse.json({ error: "CRON_SECRET sozlanmagan" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ruxsat yo'q" }, { status: 401 });
  }

  const enabled = await isFeatureEnabled("vip.adabiyotx_sync_enabled").catch(() => false);
  if (!enabled) {
    return NextResponse.json({ ok: true, skipped: "flag o'chiq" });
  }

  const result = await sweepAdabiyotXChannels();
  console.info("[cron] adabiyotx:", result);

  /*
   * QISMAN NOSOZLIK 200 BILAN QAYTADI.
   *
   * Yiqilganlar kanal jadvalida belgilangan va keyingi yurishda
   * qayta ko'riladi. 500 qaytarsak, Vercel muvaffaqiyatli
   * uzatilganlar ustidan ham qayta yurardi.
   */
  return NextResponse.json({ ok: true, ...result });
}
