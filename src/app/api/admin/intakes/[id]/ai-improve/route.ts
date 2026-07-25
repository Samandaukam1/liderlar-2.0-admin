import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { reviewIntakeAnswers, moderateContent } from "@/lib/intake/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/intakes/[id]/ai-improve
 * Runs the structured Jaxongir AI editorial pass over every answer and writes
 * the results back (original text is never overwritten). Never auto-publishes.
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

  const db = createSupabaseAdminClient();

  // Idempotency: return early if this exact run already completed.
  if (body.idempotency_key) {
    const { data: prior } = await db
      .from("candidate_intake_ai_runs")
      .select("id, status")
      .eq("idempotency_key", body.idempotency_key)
      .maybeSingle();
    if (prior?.status === "completed") {
      return NextResponse.json({ ok: true, cached: true });
    }
  }

  const { data: intake } = await db
    .from("candidate_intakes")
    .select("id, full_name, template_id, status")
    .eq("id", intakeId)
    .maybeSingle();
  if (!intake) return NextResponse.json({ error: "Anketa topilmadi" }, { status: 404 });

  const [{ data: questions }, { data: answers }] = await Promise.all([
    db.from("candidate_intake_questions").select("question_no, prompt").eq("template_id", intake.template_id).order("question_no"),
    db.from("candidate_intake_answers").select("question_no, plain_text, answer_state").eq("intake_id", intakeId).order("question_no"),
  ]);

  const promptByNo = new Map((questions ?? []).map((q) => [q.question_no as number, q.prompt as string]));
  const reviewInput = (answers ?? [])
    .filter((a) => (a.answer_state as string) === "answered" && (a.plain_text as string)?.trim())
    .map((a) => ({
      question_no: a.question_no as number,
      prompt: promptByNo.get(a.question_no as number) ?? "",
      plain_text: a.plain_text as string,
    }));

  if (reviewInput.length === 0) {
    return NextResponse.json({ error: "Yaxshilash uchun javoblar yo‘q" }, { status: 400 });
  }

  await db.from("candidate_intakes").update({ status: "ai_reviewing" }).eq("id", intakeId);

  try {
    const review = await reviewIntakeAnswers({
      intakeId,
      candidateName: intake.full_name as string,
      answers: reviewInput,
      actorId: admin.userId,
      idempotencyKey: body.idempotency_key ?? null,
    });

    // Write per-answer AI results (original text kept intact).
    for (const a of review.answers) {
      await db
        .from("candidate_intake_answers")
        .update({
          ai_improved_text: a.improved_text,
          ai_removed_segments: a.removed_segments,
          ai_fact_flags: a.fact_flags,
          ai_clarification_questions: a.clarification_questions,
          ai_moderation_notes: a.moderation_notes,
          ai_confidence: a.confidence,
          moderation_flagged: a.moderation_notes.length > 0,
          final_text: a.improved_text,
          editor_state: "pending",
        })
        .eq("intake_id", intakeId)
        .eq("question_no", a.question_no);
    }

    // Real omni-moderation signal over the raw answers.
    let moderationSummary = review.moderation_summary;
    try {
      const mod = await moderateContent({ texts: reviewInput.map((a) => a.plain_text) });
      if (mod.flagged) {
        moderationSummary = `⚠️ Moderatsiya belgilari: ${mod.categories.join(", ")}. ${moderationSummary}`;
      }
    } catch {
      /* moderation failure is non-fatal */
    }

    await db
      .from("candidate_intakes")
      .update({
        biography_draft: review.biography_draft,
        short_bio: review.short_bio,
        global_fact_conflicts: review.global_fact_conflicts,
        editorial_commentary: review.editorial_commentary,
        moderation_summary: moderationSummary,
        ai_ready_for_review: review.ready_for_editor_review,
      })
      .eq("id", intakeId);

    return NextResponse.json({ ok: true, review });
  } catch (err) {
    await db.from("candidate_intakes").update({ status: "submitted" }).eq("id", intakeId);
    console.error("intake ai-improve failed");
    const msg = err instanceof Error && err.message.startsWith("AI rad etdi") ? err.message : "Jaxongir AI javob bera olmadi";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
