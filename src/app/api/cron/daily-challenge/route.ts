import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { runDailyChallenge } from "@/lib/challenge/daily-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/daily-challenge
 *
 * Kunlik Premium Challenge'ni 19:00 (Asia/Tashkent) dan keyin yakunlaydi
 * va g'oliblarga VIP beradi (1 -> 30, 2 -> 20, 3 -> 10 kun).
 *
 * QAYTA YURISHGA XAVFSIZ: bazadagi `finalize_daily_challenge` kunni
 * bir marta yakunlaydi, VIP esa unikal kalit bilan bir marta beriladi.
 * Shu sabab jadval bir kunda bir necha marta (va ertasi ertalab) yuradi:
 * bittasi uzilsa, keyingisi yakunlaydi.
 *
 * Xotiradagi taymer YO'Q — faqat Vercel Cron.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET sozlanmagan — challenge yakunlanmadi");
    return NextResponse.json({ error: "CRON_SECRET sozlanmagan" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ruxsat yo'q" }, { status: 401 });
  }

  const result = await runDailyChallenge();
  console.info("[cron] kunlik challenge:", result);
  return NextResponse.json({ ok: true, ...result });
}
