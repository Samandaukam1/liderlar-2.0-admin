import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { loadReferralCounts, sweepReferralCodes } from "@/lib/referral/code-sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/referral-codes
 *
 * Kodsiz akkauntlarga shaxsiy tavsiya kodi beradi (§75: kod har bir
 * akkauntda bo'ladi, VIP imtiyozi emas).
 *
 * YANGI AKKAUNTLAR UCHUN HAM: bir martalik skript faqat o'tmishni
 * yopardi va ertaga ro'yxatdan o'tgan odam kodsiz qolardi.
 *
 * QAYTA ISHGA TUSHIRISHGA XAVFSIZ: kodi bor profil o'tkazib
 * yuboriladi, ya'ni vazifa necha marta yurganining ahamiyati yo'q.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET sozlanmagan — tavsiya kodlari tarqatilmadi");
    return NextResponse.json({ error: "CRON_SECRET sozlanmagan" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ruxsat yo'q" }, { status: 401 });
  }

  const result = await sweepReferralCodes();

  /*
   * SANOQ HAR YURISHDA LOGGA TUSHADI.
   *
   * §74 migratsiya sanoqlarini talab qiladi va ularni O'YLAB
   * CHIQARMASLIKNI. Shu sababli sanoq bazadan o'qiladi: "nechta
   * akkaunt kodsiz qoldi" degan savolga javob real bo'ladi.
   */
  const counts = await loadReferralCounts();
  console.info("[cron] tavsiya kodlari:", { ...result, counts });

  /*
   * Qisman nosozlik 200 bilan qaytadi: qolgan profillar keyingi
   * yurishda qayta ko'riladi. 500 qaytarsak, Vercel muvaffaqiyatli
   * yaratilganlar ustidan ham qayta yurardi.
   */
  return NextResponse.json({ ok: true, ...result, counts });
}
