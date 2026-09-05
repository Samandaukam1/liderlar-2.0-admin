import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import {
  IntakeImprovementError,
  runIntakeAiImprovement,
} from "@/lib/intake/improve-service";
import { promoteIntakeToDraft, publishPromotedIntake } from "@/lib/intake/promotion-service";
import { findPublishedNamesake, NAMESAKE_SKIP_MESSAGE } from "@/lib/intake/namesake";
import { isBlacklisted } from "@/lib/intake/blacklist";
import { createPostDraft, getPost, updatePost } from "./repository.ts";
import { preparePortrait, refreshPostCaption, renderAndStorePost } from "./service.ts";
import { downloadPostAsset } from "./storage.ts";
import {
  deliverPostToSubscribers,
  getPostDeliveryChatIds,
  isTelegramConfigured,
} from "./telegram.ts";

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
/**
 * Upper bound on how far back the sweep will reach. Defence in depth against a
 * backfill or a manual status change ever turning a long history of intakes
 * into one mass automated run of AI calls, approvals and publications.
 */
export const PIPELINE_MAX_AGE_DAYS = 14;
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
  | "telegram"
  | "done";

/** Uzbek labels for the admin batch table's live "joriy bosqich" column. */
export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  ai_improvement: "Jaxongir AI — javoblarni yaxshilash",
  fact_validation: "Faktlarni tekshirish",
  approval: "Tasdiqlanmoqda",
  promotion: "Nomzodga aylantirilmoqda",
  publication: "Nashr qilinmoqda",
  post_draft: "Post yaratilmoqda",
  portrait: "Portret tayyorlanmoqda",
  render: "Post render qilinmoqda",
  caption: "Caption tayyorlanmoqda",
  telegram: "Telegramga yuborilmoqda",
  done: "Tayyor",
};

export interface PipelineRunResult {
  intakeId: string;
  ok: boolean;
  stage: PipelineStage;
  postId?: string;
  candidateId?: string;
  needsReview?: boolean;
  error?: string;
  telegramSent?: number;
  telegramFailed?: number;
}

interface DueIntake {
  id: string;
  status: string;
  candidate_id: string | null;
  post_pipeline_attempts: number;
}

/**
 * Intakes cleared to run: payment confirmed, window elapsed, attempts left.
 *
 * The payment gate is the important half. Publishing used to start two hours
 * after submission regardless, which meant a candidate who never paid still got
 * an article, a post and a Telegram send. Confirming payment in the bot is now
 * what sets `post_pipeline_process_after`, so this filter is both the gate and
 * the trigger; nothing else can put an unpaid candidate in front of the worker.
 */
export async function findDueIntakes(limit = PIPELINE_BATCH_SIZE): Promise<DueIntake[]> {
  const db = createSupabaseAdminClient();
  const oldestAllowed = new Date(
    Date.now() - PIPELINE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data } = await db
    .from("candidate_intakes")
    .select("id, status, candidate_id, post_pipeline_attempts")
    .eq("payment_status", "paid")
    .in("post_pipeline_status", ["pending", "failed"])
    .lte("post_pipeline_process_after", new Date().toISOString())
    .gte("post_pipeline_process_after", oldestAllowed)
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

export interface PipelineOptions {
  /**
   * Called as each stage begins, so the batch table can show a live "joriy
   * bosqich" without the worker having to know anything about batches.
   */
  onStage?: (stage: PipelineStage) => Promise<void> | void;
}

/** Runs the whole chain for one intake. */
export async function runPipelineForIntake(
  intake: DueIntake,
  options: PipelineOptions = {},
): Promise<PipelineRunResult> {
  const intakeId = intake.id;
  const stage = async (next: PipelineStage) => {
    try {
      await options.onStage?.(next);
    } catch {
      /* progress reporting must never fail the run */
    }
  };

  /* -------- 1. fact-preserving answer improvement -------- */
  if (["draft", "submitted", "ai_reviewing"].includes(intake.status)) {
    await stage("ai_improvement");
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
    await stage("approval");
    await markPipeline(intakeId, {
      status: "approved",
      // The manual "Tasdiqlash" action stamps this too; leaving it null made an
      // automatically approved intake indistinguishable from a never-reviewed one.
      approved_at: new Date().toISOString(),
    });
  }

  /* -------- 3. promotion: structured draft + biographic article -------- */
  const db = createSupabaseAdminClient();
  let { data: current } = await db
    .from("candidate_intakes")
    .select("status, candidate_id, full_name")
    .eq("id", intakeId)
    .maybeSingle();

  // Nobody is published twice. A returning candidate — or a second form under
  // the same name — would otherwise have their LIVE article rewritten and be
  // posted again as if they were new. The run stops for a human instead.
  const namesake = await findPublishedNamesake(
    (current?.full_name as string) ?? "",
    (current?.candidate_id as string | null) ?? intake.candidate_id,
  );
  if (namesake) {
    return fail(intakeId, "promotion", NAMESAKE_SKIP_MESSAGE, true);
  }

  // A terminated contract stops the run wherever it reaches this point — the
  // automatic payment-triggered path included, not just the batch.
  if (await isBlacklisted((current?.full_name as string) ?? "")) {
    return fail(intakeId, "promotion", "Shartnoma buzildi — qora ro‘yxatdagi nomzod.", true);
  }

  if (current?.status === "approved") {
    await stage("promotion");
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
    await stage("publication");
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
  await stage("post_draft");
  let post;
  try {
    // Idempotent by candidate: an existing draft is reused and refreshed rather
    // than duplicated, so a retry after a later failure cannot double-post.
    post = await createPostDraft({ candidateId, createdBy: null });
  } catch (err) {
    return fail(intakeId, "post_draft", err instanceof Error ? err.message : String(err), true);
  }

  /* -------- 6. portrait background removal -------- */
  await stage("portrait");
  const portrait = await preparePortrait(post);
  if (portrait.warning) {
    await updatePost(post.id, { status: "needs_review", error: portrait.warning.message });
    return fail(intakeId, "portrait", portrait.warning.message, true);
  }

  /* -------- 7. render 1080x1080 -------- */
  await stage("render");
  let rendered;
  try {
    rendered = await renderAndStorePost(post.id, { actorId: null });
  } catch (err) {
    return fail(intakeId, "render", err instanceof Error ? err.message : String(err), false);
  }

  /* -------- 8. Telegram caption -------- */
  await stage("caption");
  const withCaption = await refreshPostCaption(rendered.post);
  const captionBlocked = withCaption.status === "needs_review" || rendered.warnings.length > 0;

  /* -------- 9. Telegram delivery -------- */
  let delivery = { sent: 0, failed: 0, skipped: 0 };
  let deliveryError: string | null = null;
  if (!captionBlocked) {
    await stage("telegram");
    delivery = await deliverFinishedPost(withCaption.id, candidateId, withCaption.telegramCaption);
    // `skipped` means the chat already holds this exact post from an earlier
    // run. Counting that as a failure is what would turn a healthy retry into
    // a permanent needs_review.
    if (delivery.sent === 0 && delivery.skipped === 0) {
      deliveryError = "Telegramga yuborilmadi — hech bir manzil qabul qilmadi.";
    }
  }

  const needsReview = captionBlocked || deliveryError !== null;

  await markPipeline(intakeId, {
    post_pipeline_status: needsReview ? "needs_review" : "completed",
    post_pipeline_finished_at: new Date().toISOString(),
    post_pipeline_error: needsReview
      ? (rendered.warnings.map((w) => w.message).join(" · ") ||
          withCaption.error ||
          deliveryError ||
          "")
          .slice(0, 900)
      : null,
  });

  await logAudit({
    actorId: null,
    action: "post.pipeline_completed",
    entityType: "candidate_social_posts",
    entityId: withCaption.id,
    severity: needsReview ? "warning" : "info",
    metadata: {
      intakeId,
      candidateId,
      needsReview,
      telegramSent: delivery.sent,
      telegramFailed: delivery.failed,
    },
  });

  if (!needsReview) await stage("done");

  return {
    intakeId,
    ok: true,
    stage: needsReview ? "caption" : "done",
    postId: withCaption.id,
    candidateId,
    needsReview,
    telegramSent: delivery.sent,
    telegramFailed: delivery.failed,
  };
}

/**
 * Sends a finished post to the configured editorial chats.
 *
 * Delivery is the last stage on purpose: everything before it can be retried
 * cheaply, while a sent Telegram message cannot be recalled. Per-chat failures
 * are isolated by deliverPostToSubscribers, and a subscriber that already has a
 * `sent` row for this post is skipped — so a retry resumes instead of
 * double-posting. A throw here is caught rather than propagated: the article and
 * post are already correct, and only the send needs another attempt.
 */
async function deliverFinishedPost(
  postId: string,
  candidateId: string,
  caption: string | null,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const nothing = { sent: 0, failed: 0, skipped: 0 };
  if (!isTelegramConfigured() || !caption) return nothing;

  const photo = await downloadPostAsset(candidateId, "render");
  if (!photo) {
    console.error(`[pipeline] render topilmadi post=${postId}`);
    return nothing;
  }

  try {
    const chatIds = await getPostDeliveryChatIds();
    const result = await deliverPostToSubscribers(postId, photo, caption, {
      actorId: null,
      chatIds: chatIds.length > 0 ? chatIds : undefined,
    });
    if (result.sent > 0) {
      await updatePost(postId, {
        status: "published",
        published_at: new Date().toISOString(),
        telegram_last_sent_at: new Date().toISOString(),
        telegram_sent_count: result.sent,
        telegram_failed_count: result.failed,
      });
    }
    return { sent: result.sent, failed: result.failed, skipped: result.skipped };
  } catch (err) {
    console.error("[pipeline] telegram delivery failed", err instanceof Error ? err.message : err);
    return nothing;
  }
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
