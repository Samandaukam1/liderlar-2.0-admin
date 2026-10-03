import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { sweepReferralAwards } from "@/lib/referral/award-sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/referral-awards
 *
 * Tavsiya ballari: shaxsiy kod bilan kelgan ariza egasi TO'LOV qilgan
 * va profili CHOP ETILGAN bo'lsa, kod egasiga ball beradi. Ariza va
 * anketa telefon raqami bo'yicha bog'lanadi (`intake-match.ts`).
 *
 * FLAG OSTIDA: `vip.referrals_enabled` o'chiq bo'lsa, vazifa hech narsa
 * qilmaydi — ballar egasi yoqmaguncha bazaga tushmaydi.
 *
 * QAYTA ISHGA TUSHIRISHGA XAVFSIZ: ball unikal kalit bilan bir marta
 * yoziladi, bosqich faqat oldinga siljiydi.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET sozlanmagan — tavsiya ballari berilmadi");
    return NextResponse.json({ error: "CRON_SECRET sozlanmagan" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ruxsat yo'q" }, { status: 401 });
  }

  const enabled = await isFeatureEnabled("vip.referrals_enabled").catch(() => false);
  if (!enabled) {
    return NextResponse.json({ ok: true, skipped: "flag_off" });
  }

  const result = await sweepReferralAwards();

  /*
   * Qisman nosozlik 200 bilan qaytadi: ochiq qolganlar keyingi
   * yurishda qayta ko'riladi, berilgan ballar esa qayta yozilmaydi.
   */
  return NextResponse.json({ ok: true, ...result });
}
