import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import {
  IntakeImprovementError,
  runIntakeAiImprovement,
} from "@/lib/intake/improve-service";

export const dynamic = "force-dynamic";
// The fact-preservation pass may re-prompt individual answers up to twice, so
// the budget has to cover the batch call plus the worst-case retries.
export const maxDuration = 300;

const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  no_answers: 400,
  save_failed: 500,
  ai_failed: 502,
};

/**
 * POST /api/admin/intakes/[id]/ai-improve
 * Runs the structured Jaxongir AI editorial pass over every answer and writes
 * the results back (original text is never overwritten). Never auto-publishes.
 *
 * The work itself lives in lib/intake/improve-service so the automated pipeline
 * can run the identical pass without going through HTTP.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const admin = await checkPermission("ai.use");
  if (!admin) return NextResponse.json({ error: "Ruxsat yo‘q" }, { status: 403 });
  const { id: intakeId } = await ctx.params;

  let body: { idempotency_key?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* optional body */
  }

  try {
    const result = await runIntakeAiImprovement({
      intakeId,
      actorId: admin.userId,
      idempotencyKey: body.idempotency_key ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof IntakeImprovementError) {
      return NextResponse.json({ error: err.message }, { status: STATUS_BY_CODE[err.code] ?? 502 });
    }
    throw err;
  }
}
