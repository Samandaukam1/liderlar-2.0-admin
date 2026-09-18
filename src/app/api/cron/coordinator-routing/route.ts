import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { runExpirySweep } from "@/lib/coordinators/routing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/coordinator-routing
 *
 * Muddati tugagan takliflarni qaytadan yo'naltiradi.
 *
 * LID YO'QOLMASLIGINING KAFOLATI SHU YERDA: koordinator 10 daqiqa
 * ichida javob bermasa, lid boshqasiga o'tadi; hech kim bo'lmasa
 * navbatda qolib, keyingi yugurishni kutadi.
 *
 * `CRON_SECRET` sozlanmagan bo'lsa ishlamaydi: bu endpoint admin
 * sessiyasidan ozod va sekret undagi yagona to'siq.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET sozlanmagan — koordinator marshrutlash ishlamadi");
    return NextResponse.json({ error: "CRON_SECRET sozlanmagan" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 401 });
  }

  const result = await runExpirySweep();
  return NextResponse.json({ ok: true, ...result });
}
