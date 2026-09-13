import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { runFollowupTick } from "@/lib/sales/flow/followup-runner";
import { runQueueTick } from "@/lib/sales/queue/queue-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/sales-followups
 *
 * Rejalashtirilgan sotuv follow-up'larini yuboradi (7 / 5 / 60 daqiqa).
 *
 * NEGA CRON: `setTimeout` serverless funksiyada javobdan keyin o'ladi va
 * kechiktirilgan xabar hech qachon yuborilmaydi. Navbat bazada turadi,
 * bu route esa vaqti kelganini oladi.
 *
 * Mavjud cron'lar kabi YOPIQ ISHLAYDI: `CRON_SECRET` sozlanmagan bo'lsa
 * route umuman ishlamaydi. Aks holda bu mijozlarga xabar yuboradigan
 * ochiq tugma bo'lib qolardi.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[sales-followups] CRON_SECRET sozlanmagan — cron o‘chirilgan");
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const provided = request.headers.get("authorization");
  if (provided !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    /*
     * NAVBAT AVVAL (27-band).
     *
     * Navbatda mijozning JAVOB KUTAYOTGAN savoli turadi; follow-up
     * esa bizning eslatmamiz. Mijozni kuttirmaslik muhimroq.
     *
     * Ikkalasi ketma-ket: parallel bajarilsa, navbat ishchisi
     * yuborgan javobdan keyin follow-up runner eskirgan eslatmani
     * yuborib qo'yishi mumkin edi.
     */
    const queue = await runQueueTick();
    if (queue.claimed > 0) {
      console.log(
        `[sales-queue] claimed=${queue.claimed} ok=${queue.succeeded} ` +
          `requeued=${queue.requeued} skipped=${queue.skipped} ` +
          `failed=${queue.failed} dead=${queue.deadLettered}`,
      );
    }

    const result = await runFollowupTick();
    if (result.due > 0) {
      console.log(
        `[sales-followups] due=${result.due} claimed=${result.claimed} sent=${result.sent} ` +
          `skipped=${result.skipped} failed=${result.failed} unknown=${result.unknown}`,
      );
    }
    return NextResponse.json({ ok: true, queue, ...result });
  } catch (err) {
    console.error(
      "[sales-followups] xato:",
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
