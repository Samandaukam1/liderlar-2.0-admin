import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { sweepExpiredSubscriptions } from "@/lib/vip/subscription-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/vip-expiry
 *
 * Muddati kelgan VIP obunalarni yopadi: `active` -> `grace_period`
 * -> `expired`.
 *
 * NEGA FON VAZIFASI, O'QISH PAYTIDA EMAS: holatni o'qiyotgan har bir
 * so'rov uni o'zgartirsa, oddiy sahifa ko'rish yozuv amaliga
 * aylanardi — va bir vaqtda kelgan ikki so'rov bir xil o'tishni ikki
 * marta yozishga urinardi.
 *
 * SHU BILAN BIRGA huquq tekshiruvi SANAGA ham qaraydi (`entitlements.ts`),
 * ya'ni bu vazifa kechiksa ham muddati o'tgan obuna huquq BERMAYDI.
 * Vazifa holatni tartibga soladi, xavfsizlikni ushlab turmaydi.
 *
 * KUNDA BIR MARTA yetarli: imtiyoz muddati kunlarda o'lchanadi va
 * soatlik aniqlik tijoriy ma'no bermaydi.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET sozlanmagan — VIP muddatlari yopilmadi");
    return NextResponse.json({ error: "CRON_SECRET sozlanmagan" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ruxsat yo'q" }, { status: 401 });
  }

  const result = await sweepExpiredSubscriptions();

  /*
   * QISMAN NOSOZLIK 200 BILAN QAYTADI.
   *
   * Bir nechta obuna yopilmagan bo'lsa ham, qolganlari yopilgan va
   * vazifa ishlagan. 500 qaytarsak, Vercel uni muvaffaqiyatsiz deb
   * belgilab qayta urinardi — natijada muvaffaqiyatli yopilganlar
   * ustidan yana o'tilardi.
   *
   * Yopilmaganlari keyingi yurishda qayta ko'riladi: vazifa
   * idempotent va ularning muddati hali ham o'tgan holatda turadi.
   */
  if (result.failed > 0) {
    console.error("[cron] ba'zi VIP obunalar yopilmadi:", result);
  }

  return NextResponse.json({ ok: true, ...result });
}
