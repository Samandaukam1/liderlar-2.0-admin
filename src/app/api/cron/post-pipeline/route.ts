import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { runDuePipelines } from "@/lib/post-studio/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Each due intake runs several OpenAI calls plus a render; the batch is capped
// at three, so the budget has to cover the worst case of all three.
export const maxDuration = 300;

/**
 * GET /api/cron/post-pipeline
 *
 * Vercel Cron entry point for the two-hour automated pipeline. Vercel signs its
 * cron requests with CRON_SECRET; without that header the route is a no-op, so
 * a public hit cannot burn OpenAI credit.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 401 });
  }

  const results = await runDuePipelines();
  return NextResponse.json({
    ok: true,
    processed: results.length,
    needsReview: results.filter((r) => r.needsReview).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
