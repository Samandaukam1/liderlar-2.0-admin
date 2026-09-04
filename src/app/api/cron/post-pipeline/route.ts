import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { runDuePipelines } from "@/lib/post-studio/pipeline";
import { sendDueScheduledPosts } from "@/lib/post-studio/scheduler";
import { runPaymentAskSweep } from "@/lib/intake/payment";
import { getPostDeliveryChatIds } from "@/lib/post-studio/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Each due intake runs several OpenAI calls plus a render; the batch is capped
// at three, so the budget has to cover the worst case of all three.
export const maxDuration = 300;

/**
 * GET /api/cron/post-pipeline
 *
 * Vercel Cron entry point for the two-hour automated pipeline. Vercel signs its
 * cron requests with `Authorization: Bearer $CRON_SECRET`.
 *
 * This route is exempt from the admin session middleware (cron has no cookie),
 * so the secret is the ONLY thing standing in front of it. It therefore fails
 * closed: with CRON_SECRET unset the endpoint was publicly callable and anyone
 * could start pipeline runs that spend OpenAI credit and publish candidates.
 * Refusing to run is the safe default — the pipeline pausing is visible and
 * recoverable, an open endpoint is neither.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET sozlanmagan — pipeline ishga tushirilmadi");
    return NextResponse.json(
      { error: "CRON_SECRET sozlanmagan", processed: 0 },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 401 });
  }

  // Pipeline first: a run that finishes here can be picked up by the very next
  // tick's scheduled sweep rather than waiting a full cycle.
  const results = await runDuePipelines();
  const scheduled = await sendDueScheduledPosts();

  // Payment questions go to the same editorial chats the finished posts do.
  // The sweep itself enforces the two-hour gap per candidate, so running it on
  // every quarter-hour tick asks nobody twice.
  const paymentAsks = await runPaymentAskSweep(await getPostDeliveryChatIds());

  return NextResponse.json({
    ok: true,
    processed: results.length,
    needsReview: results.filter((r) => r.needsReview).length,
    failed: results.filter((r) => !r.ok).length,
    scheduledSent: scheduled.filter((r) => r.ok).length,
    paymentAsked: paymentAsks.length,
    results,
    scheduled,
    paymentAsks,
  });
}
