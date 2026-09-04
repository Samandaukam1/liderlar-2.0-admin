import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { runBatchTick } from "@/lib/intake/publish-batch";
import { runDuePipelines } from "@/lib/post-studio/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One batch item is several OpenAI calls, an ONNX cut-out, a 1080x1080 render
// and a Telegram send — the budget has to cover the slowest of those end to end.
export const maxDuration = 300;

/**
 * GET /api/cron/intake-publish-batches
 *
 * The fast worker. It runs every couple of minutes and does two things:
 *
 *  1. advances the active publish batch by exactly one candidate;
 *  2. picks up candidates whose payment was just confirmed in the bot.
 *
 * Both are claim-locked in the database, so overlapping invocations — which a
 * short interval guarantees — cannot process the same candidate twice. That is
 * also what makes a function timeout survivable: nothing is held in memory, and
 * the next tick resumes from the stored stage.
 *
 * Like the pipeline cron this fails closed: without CRON_SECRET the endpoint
 * would be an open trigger for work that spends OpenAI credit and publishes
 * candidates, so it refuses to run rather than run unauthenticated.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET sozlanmagan — batch worker ishga tushirilmadi");
    return NextResponse.json({ error: "CRON_SECRET sozlanmagan" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 401 });
  }

  const batch = await runBatchTick();

  // A payment confirmed in the bot sets the intake due immediately; this is
  // what turns that into a published candidate within a couple of minutes
  // rather than at the next quarter-hour pipeline tick. One at a time, so a
  // manual batch running alongside still gets its share of the budget.
  const paymentTriggered = batch.itemId ? [] : await runDuePipelines(1);

  return NextResponse.json({
    ok: true,
    batch,
    paymentTriggered: paymentTriggered.length,
    results: paymentTriggered,
  });
}
