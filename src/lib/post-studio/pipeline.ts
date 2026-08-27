import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  IntakeImprovementError,
  runIntakeAiImprovement,
} from "@/lib/intake/improve-service";
import { promoteIntakeToDraft, publishPromotedIntake } from "@/lib/intake/promotion-service";
import { createPostDraft, getPost, updatePost } from "./repository.ts";
import { preparePortrait, refreshPostCaption, renderAndStorePost } from "./service.ts";

/**
 * The automated post pipeline that runs two hours after a candidate submits
 * their intake form.
 *
 * Timing is *not* a setTimeout and not a request held open: the intake trigger
 * stamps `post_pipeline_process_after = submitted_at + 2 hours`, and a Vercel
 * Cron hit on /api/cron/post-pipeline picks up whatever is due. That survives
 * cold starts, deploys and function timeouts, which a timer would not.
 *
 * Every stage that cannot guarantee a correct result stops the run at
 * `needs_review` instead of publishing: lost facts, an unpublished article, a
 * failed cut-out, or a quote/name that will not fit its box.
 */

export const PIPELINE_MAX_ATTEMPTS = 3;
/** How many intakes one cron invocation will process, to stay inside the budget. */
export const PIPELINE_BATCH_SIZE = 3;

export type PipelineStage =
  | "ai_improvement"
  | "fact_validation"
  | "approval"
  | "promotion"
  | "publication"
  | "post_draft"
  | "portrait"
  | "render"
  | "caption"
  | "done";

export interface PipelineRunResult {
  intakeId: string;
  ok: boolean;
  stage: PipelineStage;
  postId?: string;
  candidateId?: string;
  needsReview?: boolean;
  error?: string;
}

interface DueIntake {
  id: string;
  status: string;
  candidate_id: string | null;
  post_pipeline_attempts: number;
}

/** Intakes whose two-hour window has elapsed and that have attempts left. */
export async function findDueIntakes(limit = PIPELINE_BATCH_SIZE): Promise<DueIntake[]> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("candidate_intakes")
    .select("id, status, candidate_id, post_pipeline_attempts")
    .in("post_pipeline_status", ["pending", "failed"])
    .lte("post_pipeline_process_after", new Date().toISOString())
    .lt("post_pipeline_attempts", PIPELINE_MAX_ATTEMPTS)
    .order("post_pipeline_process_after", { ascending: true })
    .limit(limit);

  return (data ?? []) as DueIntake[];
}

async function markPipeline(
  intakeId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const db = createSupabaseAdminClient();
  await db.from("candidate_intakes").update(patch).eq("id", intakeId);
}

/**
 * Claims an intake so two overlapping cron invocations cannot process it twice.
 * The status guard makes the update itself the lock.
 */
async function claim(intake: DueIntake): Promise<boolean> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("candidate_intakes")
    .update({
      post_pipeline_status: "running",
      post_pipeline_started_at: new Date().toISOString(),
      post_pipeline_attempts: intake.post_pipeline_attempts + 1,
      post_pipeline_error: null,
    })
    .eq("id", intake.id)
    .in("post_pipeline_status", ["pending", "failed"])
    .select("id");

  return (data?.length ?? 0) > 0;
}

/**
 * Fact gate: a run only proceeds automatically when the editorial pass kept
 * every detected fact. If any answer had to fall back to the original text, a
 * human reads it before anything is published.
 */
function factGatePassed(warnings: { kept_original: boolean }[] | undefined): boolean {
  return !(warnings ?? []).some((w) => w.kept_original);
}

async function fail(
  intakeId: string,
  stage: PipelineStage,
  error: string,
  needsReview: boolean,
): Promise<PipelineRunResult> {
  await markPipeline(intakeId, {
    post_pipeline_status: needsReview ? "needs_review" : "failed",
    post_pipeline_error: `${stage}: ${error}`.slice(0, 900),
    post_pipeline_finished_at: new Date().toISOString(),
  });
  await logAudit({
    actorId: null,
    action: "post.pipeline_stopped",
    entityType: "candidate_intake",
    entityId: intakeId,
    severity: needsReview ? "warning" : "critical",
    metadata: { stage, error, needsReview },
  });
  return { intakeId, ok: false, stage, error, needsReview };
}

/** Runs the whole chain for one intake. */
export async function runPipelineForIntake(intake: DueIntake): Promise<PipelineRunResult> {
  const intakeId = intake.id;

  /* -------- 1. fact-preserving answer improvement -------- */
  if (["draft", "submitted", "ai_reviewing"].includes(intake.status)) {
    try {
      const improvement = await runIntakeAiImprovement({ intakeId, actorId: null });
      if (!factGatePassed(improvement.fact_warnings)) {
        return fail(
          intakeId,
          "fact_validation",
          "Javoblarni yaxshilashda ayrim faktlar saqlanmadi — qo‘lda tekshirish kerak.",
          true,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isReviewable = err instanceof IntakeImprovementError && err.code === "no_answers";
      return fail(intakeId, "ai_improvement", message, isReviewable);
    }

    /* -------- 2. auto-approval (only after a clean fact gate) -------- */
    await markPipeline(intakeId, { status: "approved" });
  }

  /* -------- 3. promotion: structured draft + biographic article -------- */
  const db = createSupabaseAdminClient();
  let { data: current } = await db
    .from("candidate_intakes")
    .select("status, candidate_id")
    .eq("id", intakeId)
    .maybeSingle();

  if (current?.status === "approved") {
    const promoted = await promoteIntakeToDraft(intakeId, null);
    if (!promoted.ok) return fail(intakeId, "promotion", promoted.error ?? "Promote xatosi", true);
    ({ data: current } = await db
      .from("candidate_intakes")
      .select("status, candidate_id")
      .eq("id", intakeId)
      .maybeSingle());
  }

  /* -------- 4. publication -> canonical article URL -------- */
  if (current?.status === "promoted") {
    const published = await publishPromotedIntake(intakeId, null);
    if (!published.ok) {
      return fail(intakeId, "publication", published.error ?? "Nashr xatosi", true);
    }
  }

  const candidateId = (current?.candidate_id as string | null) ?? intake.candidate_id;
  if (!candidateId) {
    return fail(intakeId, "publication", "Nomzod yaratilmadi.", true);
  }

  /* -------- 5. social post draft -------- */
  let post;
  try {
    post = await createPostDraft({ candidateId, createdBy: null });
  } catch (err) {
    return fail(intakeId, "post_draft", err instanceof Error ? err.message : String(err), true);
  }

  /* -------- 6. portrait background removal -------- */
  const portrait = await preparePortrait(post);
  if (portrait.warning) {
    await updatePost(post.id, { status: "needs_review", error: portrait.warning.message });
    return fail(intakeId, "portrait", portrait.warning.message, true);
  }

  /* -------- 7. render 1080x1080 -------- */
  let rendered;
  try {
    rendered = await renderAndStorePost(post.id, { actorId: null });
  } catch (err) {
    return fail(intakeId, "render", err instanceof Error ? err.message : String(err), false);
  }

  /* -------- 8. Telegram caption -------- */
  const withCaption = await refreshPostCaption(rendered.post);
  const needsReview = withCaption.status === "needs_review" || rendered.warnings.length > 0;

  await markPipeline(intakeId, {
    post_pipeline_status: needsReview ? "needs_review" : "completed",
    post_pipeline_finished_at: new Date().toISOString(),
    post_pipeline_error: needsReview
      ? rendered.warnings.map((w) => w.message).join(" · ").slice(0, 900) || withCaption.error
      : null,
  });

  await logAudit({
    actorId: null,
    action: "post.pipeline_completed",
    entityType: "candidate_social_posts",
    entityId: withCaption.id,
    severity: needsReview ? "warning" : "info",
    metadata: { intakeId, candidateId, needsReview },
  });

  return {
    intakeId,
    ok: true,
    stage: needsReview ? "caption" : "done",
    postId: withCaption.id,
    candidateId,
    needsReview,
  };
}

/** One cron tick: claims and runs whatever is due. */
export async function runDuePipelines(limit = PIPELINE_BATCH_SIZE): Promise<PipelineRunResult[]> {
  const due = await findDueIntakes(limit);
  const results: PipelineRunResult[] = [];

  // Sequential on purpose: each run makes several OpenAI calls and one render,
  // and a lambda has neither the memory nor the time budget to fan out.
  for (const intake of due) {
    if (!(await claim(intake))) continue;
    try {
      results.push(await runPipelineForIntake(intake));
    } catch (err) {
      results.push(
        await fail(intake.id, "done", err instanceof Error ? err.message : String(err), false),
      );
    }
  }

  return results;
}

/** Re-queues a stopped run so an admin can retry after fixing the cause. */
export async function requeueIntakePipeline(intakeId: string): Promise<void> {
  await markPipeline(intakeId, {
    post_pipeline_status: "pending",
    post_pipeline_process_after: new Date().toISOString(),
    post_pipeline_attempts: 0,
    post_pipeline_error: null,
  });
}

export { getPost };
