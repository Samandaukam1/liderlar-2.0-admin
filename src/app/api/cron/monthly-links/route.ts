import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { runMonthlyLinks } from "@/lib/monthly/link-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/monthly-links
 *
 * Joriy oy uchun oylik havolalarni yaratadi.
 *
 * HAR KUNI YUGURADI, lekin oyiga bir marta ish qiladi:
 * `(candidate_id, period_key)` unikal indeksi ikkinchi
 * havolaga yo'l qo'ymaydi. Kunlik yugurish oy boshida cron
 * bir marta o'tkazib yuborsa ham havolalar baribir
 * yaratilishini kafolatlaydi.
 *
 * `CRON_SECRET` sozlanmagan bo'lsa ishlamaydi: bu endpoint
 * admin sessiyasidan ozod va sekret undagi yagona to'siq.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET sozlanmagan — oylik havolalar ishlamadi");
    return NextResponse.json({ error: "CRON_SECRET sozlanmagan" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ruxsat yo'q" }, { status: 401 });
  }

  const result = await runMonthlyLinks();
  return NextResponse.json(result);
}
