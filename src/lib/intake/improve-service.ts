import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { improveAnswerPreservingFacts, reviewIntakeAnswers, moderateContent } from "@/lib/intake/ai";
import { enforceFactPreservation } from "@/lib/intake/answer-improvement";
import { joinShortBioItems, normalizeShortBioItems } from "@/lib/candidates/short-bio";
import type { IntakeReview } from "@/lib/intake/ai";
import type { ShortBioRejection } from "@/lib/candidates/short-bio";

/**
 * The Jaxongir AI editorial pass over an intake's answers, extracted from the
 * admin route so the automated 2-hour pipeline runs *exactly* the same code an
 * admin triggers by hand — including the fact-preservation retries and the
 * short-bio badge limits. Original answer text is never overwritten.
 */

export type IntakeImprovementFailure =
  | "not_found"
  | "no_answers"
  | "ai_failed"
  | "save_failed";

export class IntakeImprovementError extends Error {
  readonly code: IntakeImprovementFailure;

  constructor(message: string, code: IntakeImprovementFailure) {
    super(message);
    this.name = "IntakeImprovementError";
    this.code = code;
  }
}

export interface IntakeImprovementResult {
  ok: true;
  cached: boolean;
  review?: IntakeReview;
  short_bio_items?: string[];
  short_bio_rejected?: ShortBioRejection[];
  fact_warnings?: Array<{
    question_no: number;
    missing: string[];
    retries: number;
    kept_original: boolean;
  }>;
}

export interface IntakeImprovementParams {
  intakeId: string;
  actorId: string | null;
  idempotencyKey?: string | null;
}

export async function runIntakeAiImprovement(
  params: IntakeImprovementParams,
): Promise<IntakeImprovementResult> {
  const intakeId = params.intakeId;
  const db = createSupabaseAdminClient();

  // Idempotency: return early if this exact run already completed.
  if (params.idempotencyKey) {
    const { data: prior } = await db
      .from("candidate_intake_ai_runs")
      .select("id, status")
      .eq("idempotency_key", params.idempotencyKey)
      .maybeSingle();
    if (prior?.status === "completed") {
      return { ok: true, cached: true };
    }
  }

  const { data: intake } = await db
    .from("candidate_intakes")
    .select("id, full_name, template_id, status")
    .eq("id", intakeId)
    .maybeSingle();
  if (!intake) throw new IntakeImprovementError("Anketa topilmadi", "not_found");

  const [{ data: questions }, { data: answers }] = await Promise.all([
    db.from("candidate_intake_questions").select("question_no, prompt").eq("template_id", intake.template_id).order("question_no"),
    db.from("candidate_intake_answers").select("id, question_no, plain_text, answer_state").eq("intake_id", intakeId).order("question_no"),
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
    throw new IntakeImprovementError("Yaxshilash uchun javoblar yo‘q", "no_answers");
  }

  await db.from("candidate_intakes").update({ status: "ai_reviewing" }).eq("id", intakeId);

  try {
    const review = await reviewIntakeAnswers({
      intakeId,
      candidateName: intake.full_name as string,
      answers: reviewInput,
      actorId: params.actorId,
      idempotencyKey: params.idempotencyKey ?? null,
    });

    // Write per-answer AI results (original text kept intact). Every improved
    // answer is checked against its original first: an edit that dropped a
    // date, number, institution or quote is re-prompted, and if it still loses
    // them the raw answer is kept rather than a shorter, wrong one.
    const originalByNo = new Map(reviewInput.map((a) => [a.question_no, a.plain_text]));
    const promptByNoForRetry = new Map(reviewInput.map((a) => [a.question_no, a.prompt]));
    const factWarnings: Array<{
      question_no: number;
      missing: string[];
      retries: number;
      kept_original: boolean;
    }> = [];

    for (const a of review.answers) {
      const original = originalByNo.get(a.question_no) ?? a.original_text ?? "";
      const outcome = await enforceFactPreservation({
        original,
        questionPrompt: promptByNoForRetry.get(a.question_no) ?? "",
        firstImproved: a.improved_text,
        improve: improveAnswerPreservingFacts,
      });

      if (!outcome.report.ok) {
        factWarnings.push({
          question_no: a.question_no,
          missing: outcome.report.missing.map((fact) => fact.value),
          retries: outcome.retries,
          kept_original: outcome.fellBackToOriginal,
        });
      }

      const { error: answerWriteError } = await db
        .from("candidate_intake_answers")
        .update({
          ai_improved_text: outcome.improvedText,
          ai_preserved_facts: outcome.report.detected.map((fact) => fact.value),
          ai_fact_preservation: {
            ok: outcome.report.ok,
            detected: outcome.report.detected.length,
            preserved: outcome.report.preservedCount,
            missing: outcome.report.missing.map((fact) => ({ kind: fact.kind, value: fact.value })),
            retries: outcome.retries,
            kept_original: outcome.fellBackToOriginal,
          },
          ai_removed_segments: a.removed_segments,
          ai_fact_flags: a.fact_flags,
          ai_clarification_questions: a.clarification_questions,
          ai_moderation_notes: a.moderation_notes,
          ai_confidence: a.confidence,
          moderation_flagged: a.moderation_notes.length > 0,
          final_text: outcome.improvedText,
          editor_state: "pending",
        })
        .eq("intake_id", intakeId)
        .eq("question_no", a.question_no);

      // A failed write here used to pass silently, so the improved answer was
      // simply never stored and the panel kept reporting "AI hali ishlamagan".
      // Schema drift (a missing column) reports as a bare 400, so the whole
      // PostgREST error has to reach the logs and the run has to fail loudly.
      if (answerWriteError) {
        console.error(
          "AI_IMPROVE_ANSWER_WRITE_FAILED",
          JSON.stringify({
            intakeId,
            questionNo: a.question_no,
            code: answerWriteError.code ?? null,
            message: answerWriteError.message ?? null,
            details: answerWriteError.details ?? null,
            hint: answerWriteError.hint ?? null,
          }),
        );
        throw new Error(
          `Javob saqlanmadi (savol ${a.question_no}): ${answerWriteError.code ?? "unknown"} ${answerWriteError.message}`,
        );
      }
    }

    // Candidate-visible AI feedback: replace the unresolved set with a fresh one
    // (per-answer clarification questions + fact conflicts). Best-effort.
    try {
      const answerIdByNo = new Map((answers ?? []).map((a) => [a.question_no as number, a.id as string]));
      await db.from("candidate_intake_ai_feedback").delete().eq("intake_id", intakeId).eq("is_resolved", false);
      const feedbackRows: Record<string, unknown>[] = [];
      for (const a of review.answers) {
        const answerId = answerIdByNo.get(a.question_no) ?? null;
        if (a.clarification_questions.length > 0) {
          feedbackRows.push({
            intake_id: intakeId,
            answer_id: answerId,
            question_no: a.question_no,
            feedback_text: a.clarification_questions.join("\n"),
            feedback_type: "clarification",
            is_visible_to_candidate: true,
            is_resolved: false,
          });
        }
        if (a.fact_flags.length > 0) {
          feedbackRows.push({
            intake_id: intakeId,
            answer_id: answerId,
            question_no: a.question_no,
            feedback_text: a.fact_flags.map((f) => `${f.claim}: ${f.explanation}`).join("\n"),
            feedback_type: "fact_conflict",
            is_visible_to_candidate: true,
            is_resolved: false,
          });
        }
      }
      if (feedbackRows.length > 0) await db.from("candidate_intake_ai_feedback").insert(feedbackRows);
    } catch {
      /* feedback write is non-fatal */
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

    // The short bio is a badge row, never a paragraph: the limits are enforced
    // here so a chatty model cannot put a sentence behind "&&&".
    const shortBio = normalizeShortBioItems(review.short_bio_items);

    const { error: intakeWriteError } = await db
      .from("candidate_intakes")
      .update({
        biography_draft: review.biography_draft,
        short_bio: joinShortBioItems(shortBio.items),
        short_bio_items: shortBio.items,
        global_fact_conflicts: review.global_fact_conflicts,
        editorial_commentary: review.editorial_commentary,
        moderation_summary: moderationSummary,
        ai_ready_for_review: review.ready_for_editor_review,
      })
      .eq("id", intakeId);

    // This row carries the combined biography draft and the editorial
    // commentary shown under the answers; losing the write silently is what
    // made both disappear from the panel.
    if (intakeWriteError) {
      console.error(
        "AI_IMPROVE_INTAKE_WRITE_FAILED",
        JSON.stringify({
          intakeId,
          code: intakeWriteError.code ?? null,
          message: intakeWriteError.message ?? null,
          details: intakeWriteError.details ?? null,
          hint: intakeWriteError.hint ?? null,
        }),
      );
      throw new Error(
        `Umumiy natija saqlanmadi: ${intakeWriteError.code ?? "unknown"} ${intakeWriteError.message}`,
      );
    }

    return {
      ok: true,
      cached: false,
      review,
      short_bio_items: shortBio.items,
      short_bio_rejected: shortBio.rejected,
      fact_warnings: factWarnings,
    };
  } catch (err) {
    await db.from("candidate_intakes").update({ status: "submitted" }).eq("id", intakeId);
    const detail = err instanceof Error ? err.message : "unknown";
    console.error("intake ai-improve failed", JSON.stringify({ intakeId, message: detail }));
    // The caller is an authenticated admin, so a save failure is reported as
    // itself instead of being flattened into "AI javob bera olmadi" — that
    // generic text sent us looking at OpenAI while the write was the problem.
    const isAiRefusal = err instanceof Error && err.message.startsWith("AI rad etdi");
    const isSaveFailure = /saqlanmadi/.test(detail);
    throw new IntakeImprovementError(
      isAiRefusal || isSaveFailure ? detail : "Jaxongir AI javob bera olmadi",
      isSaveFailure ? "save_failed" : "ai_failed",
    );
  }
}
