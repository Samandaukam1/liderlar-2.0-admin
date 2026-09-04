import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { slugify } from "@/lib/utils";
import { tashkentDayRange, tashkentDayRangeForDate } from "@/lib/tashkent-day";
import {
  PIPELINE_STAGE_LABELS,
  runPipelineForIntake,
  type PipelineStage,
} from "@/lib/post-studio/pipeline";
import {
  classifyPayment,
  PROCESSABLE_STATUSES,
  selectEligibleForBatch,
  sortBySubmittedAt,
} from "./queue-order";
import {
  buildBatchProgressText,
  buildBatchStartedText,
  buildNothingToPublishText,
} from "./batch-messages";
import { findPublishedNamesake, NAMESAKE_SKIP_MESSAGE } from "./namesake";

/**
 * Boshqariladigan batch chop etish.
 *
 * Har bir nomzod uchun ish MAVJUD pipeline (runPipelineForIntake) tomonidan
 * bajariladi — bu qatlam faqat navbat, tartib, progress va ETA bilan
 * shug'ullanadi. Yangi parallel biznes-logika yo'q: AI, tasdiqlash, nomzodga
 * aylantirish, nashr, post va Telegram — hammasi admin tugmalari chaqiradigan
 * o'sha service'lar.
 *
 * Navbat holati DBda, shuning uchun Vercel funksiyasi timeout bo'lsa ham batch
 * yo'qolmaydi: keyingi cron tick qolgan joyidan davom etadi.
 */

/**
 * One item per tick. Sequential by requirement — each item runs several OpenAI
 * calls, an ONNX cut-out and a 1080x1080 render, which is already most of a
 * lambda's budget. Fanning out would trade a predictable queue for timeouts.
 */
export const BATCH_CONCURRENCY = 1;

/** Fallback ETA before any item has finished, from observed run times. */
export const DEFAULT_ITEM_DURATION_MS = 90_000;

/**
 * Statuses that belong on the "Chop etishga tayyorlar" board.
 *
 * `published` is included on purpose: the board is the day's whole picture, so
 * a candidate who already went out this morning stays visible next to the ones
 * still waiting instead of vanishing the moment they are done.
 */
const QUEUE_STATUSES = ["submitted", "approved", "promoted", "published"] as const;

export type PaymentStatus = "unknown" | "paid" | "unpaid";

export interface PublishQueueRow {
  id: string;
  fullName: string;
  phone: string | null;
  telegramUsername: string | null;
  submittedAt: string | null;
  status: string;
  paymentStatus: PaymentStatus;
  paymentAskCount: number;
  pipelineStatus: string | null;
  pipelineError: string | null;
  candidateId: string | null;
  candidateSlug: string | null;
  postId: string | null;
  /** Live batch state, when this candidate sits in an active batch. */
  batchItemStatus: string | null;
  batchStage: string | null;
  /** Already on the site under this name — from this intake or an earlier one. */
  alreadyPublished: { candidateId: string; slug: string } | null;
}

export interface PublishQueueSummary {
  /** Tashkent calendar date the board covers. */
  date: string;
  total: number;
  ready: number;
  unpaid: number;
  unknown: number;
  published: number;
  /** Rows held back because that person is already on the site. */
  duplicates: number;
}

export interface PublishQueue {
  rows: PublishQueueRow[];
  summary: PublishQueueSummary;
}

/**
 * One day's board, Asia/Tashkent.
 *
 * `date` is a YYYY-MM-DD calendar date so the panel can reach back through the
 * archive, not only the day the server happens to be inside. Omitting it means
 * today, recomputed on every call — a panel left open past midnight rolls over
 * instead of freezing on the old day.
 *
 * Ordered by `submitted_at` ASC: whoever sent their form first is processed
 * first, and the batch inherits exactly this order.
 */
export async function loadPublishQueue(
  date?: string | null,
  now: Date = new Date(),
): Promise<PublishQueue> {
  const db = createSupabaseAdminClient();
  const day = date ? tashkentDayRangeForDate(date) : tashkentDayRange(now);

  const { data, error } = await db
    .from("candidate_intakes")
    .select(
      "id, full_name, phone_e164, telegram_username, submitted_at, status, payment_status, payment_ask_count, post_pipeline_status, post_pipeline_error, candidate_id",
    )
    .is("deleted_at", null)
    .in("status", QUEUE_STATUSES)
    .not("submitted_at", "is", null)
    .gte("submitted_at", day.startIso)
    .lt("submitted_at", day.endIso)
    .order("submitted_at", { ascending: true });

  if (error) {
    console.error("[batch] queue query failed", error.message);
    return { rows: [], summary: emptySummary(day.date) };
  }

  const intakes = data ?? [];
  const candidateIds = intakes.map((r) => r.candidate_id as string | null).filter(Boolean) as string[];
  const intakeIds = intakes.map((r) => r.id as string);
  // The site's own identity for a person: the publish flow derives every
  // candidate slug from the same slugify(full_name), and the slug is unique
  // among live candidates. Matching on it is therefore the same question the
  // site would ask, not a fuzzy guess at name similarity.
  const nameSlugs = [...new Set(intakes.map((r) => slugify(r.full_name as string)))].filter(Boolean);

  const [{ data: candidates }, { data: posts }, { data: items }, { data: liveCandidates }] =
    await Promise.all([
      candidateIds.length
        ? db.from("candidates").select("id, slug").in("id", candidateIds)
        : Promise.resolve({ data: [] as { id: string; slug: string }[] }),
      candidateIds.length
        ? db.from("candidate_social_posts").select("id, candidate_id").in("candidate_id", candidateIds)
        : Promise.resolve({ data: [] as { id: string; candidate_id: string }[] }),
      intakeIds.length
        ? db
            .from("intake_publish_batch_items")
            .select("intake_id, status, current_stage, updated_at")
            .in("intake_id", intakeIds)
            .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      nameSlugs.length
        ? db
            .from("candidates")
            .select("id, slug")
            .eq("status", "published")
            .is("deleted_at", null)
            .in("slug", nameSlugs)
        : Promise.resolve({ data: [] as { id: string; slug: string }[] }),
    ]);

  const publishedBySlug = new Map(
    (liveCandidates ?? []).map((c) => [c.slug as string, c.id as string]),
  );
  const slugById = new Map((candidates ?? []).map((c) => [c.id as string, c.slug as string]));
  const postByCandidate = new Map(
    (posts ?? []).map((p) => [p.candidate_id as string, p.id as string]),
  );
  // Rows arrive newest-first, so the first entry per intake is its latest state.
  const latestItem = new Map<string, { status: string; stage: string | null }>();
  for (const item of (items ?? []) as Record<string, unknown>[]) {
    const key = item.intake_id as string;
    if (!latestItem.has(key)) {
      latestItem.set(key, {
        status: item.status as string,
        stage: (item.current_stage as string | null) ?? null,
      });
    }
  }

  // Ordered here rather than trusted from the query: the earliest submission
  // is processed first, and that promise should not rest on an `order by` that
  // a later edit could drop.
  const rows: PublishQueueRow[] = sortBySubmittedAt(
    intakes.map((r) => {
      const candidateId = (r.candidate_id as string | null) ?? null;
      const item = latestItem.get(r.id as string);
      const nameSlug = slugify(r.full_name as string);
      const liveId = publishedBySlug.get(nameSlug) ?? null;
      return {
        id: r.id as string,
        fullName: r.full_name as string,
        phone: (r.phone_e164 as string | null) ?? null,
        telegramUsername: (r.telegram_username as string | null) ?? null,
        submittedAt: (r.submitted_at as string | null) ?? null,
        status: r.status as string,
        paymentStatus: classifyPayment(r.payment_status as string | null),
        paymentAskCount: (r.payment_ask_count as number) ?? 0,
        pipelineStatus: (r.post_pipeline_status as string | null) ?? null,
        pipelineError: (r.post_pipeline_error as string | null) ?? null,
        candidateId,
        candidateSlug: candidateId ? slugById.get(candidateId) ?? null : null,
        postId: candidateId ? postByCandidate.get(candidateId) ?? null : null,
        batchItemStatus: item?.status ?? null,
        batchStage: item?.stage ? stageLabel(item.stage) : null,
        // Only a candidate OTHER than this intake's own counts as a duplicate:
        // an intake that has already been promoted naturally matches itself.
        alreadyPublished:
          liveId && liveId !== candidateId ? { candidateId: liveId, slug: nameSlug } : null,
      };
    }),
  );

  return {
    rows,
    summary: {
      date: day.date,
      total: rows.length,
      ready: rows.filter(
        (r) => r.paymentStatus === "paid" && r.status !== "published" && !r.alreadyPublished,
      ).length,
      unpaid: rows.filter((r) => r.paymentStatus === "unpaid").length,
      unknown: rows.filter((r) => r.paymentStatus === "unknown").length,
      published: rows.filter((r) => r.status === "published").length,
      duplicates: rows.filter((r) => r.alreadyPublished).length,
    },
  };
}

function emptySummary(date: string): PublishQueueSummary {
  return { date, total: 0, ready: 0, unpaid: 0, unknown: 0, published: 0, duplicates: 0 };
}

function stageLabel(stage: string): string {
  return PIPELINE_STAGE_LABELS[stage as PipelineStage] ?? stage;
}

/* ------------------------------------------------------------------ *
 * Creating a batch
 * ------------------------------------------------------------------ */

export interface CreateBatchResult {
  ok: boolean;
  batchId?: string;
  total?: number;
  error?: string;
}

/**
 * Queues today's candidates, or just the selected ones.
 *
 * Selection never changes the order: the items are sorted by `submitted_at`
 * ASC regardless of the order they were ticked in. Candidates that are already
 * published, or whose payment is not confirmed, are left out rather than
 * queued and failed — the batch only ever holds work it can actually do.
 */
export async function createPublishBatch(
  selectedIntakeIds: string[] | null,
  actorId: string | null,
  date?: string | null,
): Promise<CreateBatchResult> {
  const db = createSupabaseAdminClient();

  const { data: running } = await db
    .from("intake_publish_batches")
    .select("id")
    .in("status", ["queued", "running"])
    .limit(1);
  if ((running?.length ?? 0) > 0) {
    return { ok: false, error: "Faol batch allaqachon ishlayapti — avval uni kuting yoki bekor qiling." };
  }

  // The batch is built from the same board the admin was looking at, including
  // its date: pressing the button on an archive day must queue that day, not
  // today's (empty) one.
  const queue = await loadPublishQueue(date);
  const eligible = selectEligibleForBatch(queue.rows, selectedIntakeIds);

  if (eligible.length === 0) {
    return { ok: false, error: "Chop etishga tayyor (to‘lovi tasdiqlangan) nomzod topilmadi." };
  }

  const { data: batch, error } = await db
    .from("intake_publish_batches")
    .insert({
      status: "queued",
      selection_mode: selectedIntakeIds ? "selected" : "all",
      total: eligible.length,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error || !batch) return { ok: false, error: error?.message ?? "Batch yaratilmadi" };

  const batchId = batch.id as string;
  const { error: itemsError } = await db.from("intake_publish_batch_items").insert(
    eligible.map((row, index) => ({
      batch_id: batchId,
      intake_id: row.id,
      position: index,
      status: "queued",
    })),
  );
  if (itemsError) {
    await db.from("intake_publish_batches").delete().eq("id", batchId);
    return { ok: false, error: itemsError.message };
  }

  await logAudit({
    actorId,
    action: "intake.publish_batch_created",
    entityType: "intake_publish_batches",
    entityId: batchId,
    metadata: {
      total: eligible.length,
      selectionMode: selectedIntakeIds ? "selected" : "all",
      intakeIds: eligible.map((r) => r.id),
    },
  });

  return { ok: true, batchId, total: eligible.length };
}

/* ------------------------------------------------------------------ *
 * Running
 * ------------------------------------------------------------------ */

/**
 * Processes one queued item of the oldest active batch.
 *
 * Claiming goes through `claim_next_publish_batch_item`, a SECURITY DEFINER
 * function using `FOR UPDATE SKIP LOCKED`: two overlapping cron invocations
 * cannot take the same item, and neither blocks the other.
 *
 * Exactly one item per invocation, because a single item can take most of the
 * function's budget. The next tick continues — which is also what makes a
 * timeout mid-batch recoverable rather than fatal.
 */
export async function runBatchTick(): Promise<{
  batchId: string | null;
  itemId?: string;
  ok?: boolean;
  stage?: string;
  error?: string;
}> {
  const db = createSupabaseAdminClient();

  const { data: batches } = await db
    .from("intake_publish_batches")
    .select("id, status")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true })
    .limit(1);

  const batch = batches?.[0];
  if (!batch) return { batchId: null };
  const batchId = batch.id as string;

  // A worker killed mid-item (function timeout, deploy, cold-start eviction)
  // leaves its row marked `running` with nobody working on it. Nothing else
  // would ever pick that up — the claim only takes queued rows — so the batch
  // would stall one candidate short. Releasing stale rows first is what makes
  // a timeout recoverable rather than terminal.
  await releaseStaleItems(batchId);

  const { data: claimed, error: claimError } = await db.rpc("claim_next_publish_batch_item", {
    p_batch: batchId,
  });
  if (claimError) {
    console.error("[batch] claim failed", claimError.message);
    return { batchId, error: claimError.message };
  }

  const item = claimed as { id: string; intake_id: string; attempts: number } | null;
  // A composite-returning function can come back as a row of nulls rather than
  // a plain null, so the id — not the object — decides whether anything was
  // actually claimed.
  if (!item?.id) {
    await finalizeBatch(batchId);
    return { batchId };
  }

  const startedAt = Date.now();
  const result = await runItem(item.id, item.intake_id);
  const durationMs = Date.now() - startedAt;

  await db
    .from("intake_publish_batch_items")
    .update({
      status: result.status,
      current_stage: result.stage,
      candidate_id: result.candidateId,
      post_id: result.postId,
      telegram_sent: result.telegramSent,
      telegram_failed: result.telegramFailed,
      duration_ms: durationMs,
      error: result.error,
      finished_at: new Date().toISOString(),
    })
    .eq("id", item.id);

  await bumpBatchCounters(batchId, result.status, durationMs);
  await finalizeBatch(batchId);

  return {
    batchId,
    itemId: item.id,
    ok: result.status === "completed",
    stage: result.stage,
    error: result.error ?? undefined,
  };
}

/**
 * How long an item may sit in `running` before it is treated as abandoned.
 *
 * Comfortably above the 300-second function budget, so a slow-but-alive run is
 * never yanked out from under itself and re-processed in parallel.
 */
export const STALE_ITEM_MS = 10 * 60 * 1000;

/** Maximum times one candidate is re-claimed before the batch gives up on it. */
export const MAX_ITEM_ATTEMPTS = 3;

async function releaseStaleItems(batchId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - STALE_ITEM_MS).toISOString();

  const { data: stale } = await db
    .from("intake_publish_batch_items")
    .select("id, attempts")
    .eq("batch_id", batchId)
    .eq("status", "running")
    .lt("started_at", cutoff);

  for (const row of stale ?? []) {
    const attempts = Number(row.attempts ?? 0);
    // A candidate that keeps killing the worker is parked for a human instead
    // of being retried forever at the cost of everyone behind it in the queue.
    const exhausted = attempts >= MAX_ITEM_ATTEMPTS;
    await db
      .from("intake_publish_batch_items")
      .update(
        exhausted
          ? {
              status: "failed",
              error: `Qayta ishlash ${attempts} marta tugallanmadi (timeout).`,
              finished_at: new Date().toISOString(),
            }
          : { status: "queued", current_stage: null, started_at: null },
      )
      .eq("id", row.id as string)
      .eq("status", "running");

    if (exhausted) await bumpBatchCounters(batchId, "failed", 0);
  }
}

interface ItemOutcome {
  status: "completed" | "failed" | "needs_review" | "skipped";
  stage: string;
  candidateId: string | null;
  postId: string | null;
  telegramSent: number;
  telegramFailed: number;
  error: string | null;
}

/**
 * One candidate, end to end, through the existing pipeline.
 *
 * Every stage the pipeline runs is already idempotent — a completed AI pass is
 * cached by idempotency key, an existing candidate is reused rather than
 * duplicated, an existing post draft is refreshed, and a chat that already
 * received this post is skipped. That is what makes a retry safe to run over a
 * partly finished item.
 */
async function runItem(itemId: string, intakeId: string): Promise<ItemOutcome> {
  const db = createSupabaseAdminClient();

  const { data: intake } = await db
    .from("candidate_intakes")
    .select("id, full_name, status, candidate_id, payment_status, post_pipeline_attempts")
    .eq("id", intakeId)
    .maybeSingle();

  if (!intake) {
    return outcome("failed", "queued", null, null, "Anketa topilmadi");
  }
  // Re-checked at run time, not just at queue time: payment can be revoked, and
  // a candidate published by the automatic sweep in between needs no second run.
  if ((intake.payment_status as string) !== "paid") {
    return outcome("skipped", "queued", null, null, "To‘lov tasdiqlanmagan");
  }
  if (!(PROCESSABLE_STATUSES as readonly string[]).includes(intake.status as string)) {
    return outcome("skipped", "done", (intake.candidate_id as string) ?? null, null, null);
  }

  // Last line of defence against republishing someone already on the site. The
  // board filters them out, but a batch queued minutes ago could have been
  // overtaken — and rewriting a live article is not a mistake worth risking on
  // a stale read.
  const duplicate = await findPublishedNamesake(
    intake.full_name as string,
    (intake.candidate_id as string | null) ?? null,
  );
  if (duplicate) {
    return outcome("skipped", "done", duplicate.candidateId, null, NAMESAKE_SKIP_MESSAGE);
  }

  try {
    const result = await runPipelineForIntake(
      {
        id: intakeId,
        status: intake.status as string,
        candidate_id: (intake.candidate_id as string | null) ?? null,
        post_pipeline_attempts: (intake.post_pipeline_attempts as number) ?? 0,
      },
      {
        onStage: async (stage) => {
          await db
            .from("intake_publish_batch_items")
            .update({ current_stage: stage })
            .eq("id", itemId);
        },
      },
    );

    if (!result.ok) {
      return outcome(
        result.needsReview ? "needs_review" : "failed",
        result.stage,
        result.candidateId ?? null,
        result.postId ?? null,
        result.error ?? "Nomaʼlum xato",
      );
    }

    return {
      status: result.needsReview ? "needs_review" : "completed",
      stage: result.stage,
      candidateId: result.candidateId ?? null,
      postId: result.postId ?? null,
      telegramSent: result.telegramSent ?? 0,
      telegramFailed: result.telegramFailed ?? 0,
      error: result.needsReview ? "Qo‘lda tekshirish kerak" : null,
    };
  } catch (err) {
    return outcome(
      "failed",
      "queued",
      null,
      null,
      err instanceof Error ? err.message : String(err),
    );
  }
}

function outcome(
  status: ItemOutcome["status"],
  stage: string,
  candidateId: string | null,
  postId: string | null,
  error: string | null,
): ItemOutcome {
  return { status, stage, candidateId, postId, telegramSent: 0, telegramFailed: 0, error };
}

/**
 * Counters are read-modify-written here rather than incremented in SQL because
 * only one worker ever holds a batch item at a time (the claim guarantees it),
 * so there is no second writer to race with.
 */
async function bumpBatchCounters(
  batchId: string,
  itemStatus: ItemOutcome["status"],
  durationMs: number,
): Promise<void> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("intake_publish_batches")
    .select("completed, failed, skipped, duration_ms_total")
    .eq("id", batchId)
    .maybeSingle();
  if (!data) return;

  const patch: Record<string, unknown> = {
    duration_ms_total: Number(data.duration_ms_total ?? 0) + durationMs,
  };
  if (itemStatus === "completed" || itemStatus === "needs_review") {
    patch.completed = Number(data.completed ?? 0) + 1;
  }
  if (itemStatus === "failed") patch.failed = Number(data.failed ?? 0) + 1;
  if (itemStatus === "skipped") patch.skipped = Number(data.skipped ?? 0) + 1;

  await db.from("intake_publish_batches").update(patch).eq("id", batchId);
}

/** Closes a batch once nothing is left queued or running. */
async function finalizeBatch(batchId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  const { count: open } = await db
    .from("intake_publish_batch_items")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .in("status", ["queued", "running"]);
  if ((open ?? 0) > 0) return;

  const { data: batch } = await db
    .from("intake_publish_batches")
    .select("failed, status")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch || ["cancelled", "completed", "completed_with_errors"].includes(batch.status as string)) {
    return;
  }

  const status = Number(batch.failed ?? 0) > 0 ? "completed_with_errors" : "completed";
  await db
    .from("intake_publish_batches")
    .update({ status, finished_at: new Date().toISOString(), current_item_id: null })
    .eq("id", batchId);

  await logAudit({
    actorId: null,
    action: "intake.publish_batch_finished",
    entityType: "intake_publish_batches",
    entityId: batchId,
    severity: status === "completed" ? "info" : "warning",
    metadata: { status },
  });
}

/* ------------------------------------------------------------------ *
 * Progress
 * ------------------------------------------------------------------ */

export interface BatchItemProgress {
  id: string;
  intakeId: string;
  fullName: string;
  position: number;
  status: string;
  stage: string | null;
  error: string | null;
  telegramSent: number;
  candidateSlug: string | null;
  postId: string | null;
}

export interface BatchProgress {
  id: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  processed: number;
  percent: number;
  currentName: string | null;
  currentStage: string | null;
  elapsedMs: number;
  /** Null until at least one item has finished — never a made-up number. */
  etaMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  items: BatchItemProgress[];
}

export async function getBatchProgress(batchId: string): Promise<BatchProgress | null> {
  const db = createSupabaseAdminClient();
  const { data: batch } = await db
    .from("intake_publish_batches")
    .select("*")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) return null;

  const { data: items } = await db
    .from("intake_publish_batch_items")
    .select("id, intake_id, position, status, current_stage, error, telegram_sent, candidate_id, post_id")
    .eq("batch_id", batchId)
    .order("position", { ascending: true });

  const rows = (items ?? []) as Record<string, unknown>[];
  const intakeIds = rows.map((r) => r.intake_id as string);
  const candidateIds = rows.map((r) => r.candidate_id as string | null).filter(Boolean) as string[];

  const [{ data: intakes }, { data: candidates }] = await Promise.all([
    intakeIds.length
      ? db.from("candidate_intakes").select("id, full_name").in("id", intakeIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    candidateIds.length
      ? db.from("candidates").select("id, slug").in("id", candidateIds)
      : Promise.resolve({ data: [] as { id: string; slug: string }[] }),
  ]);
  const nameById = new Map((intakes ?? []).map((r) => [r.id as string, r.full_name as string]));
  const slugById = new Map((candidates ?? []).map((r) => [r.id as string, r.slug as string]));

  const total = Number(batch.total ?? 0);
  const completed = Number(batch.completed ?? 0);
  const failed = Number(batch.failed ?? 0);
  const skipped = Number(batch.skipped ?? 0);
  const processed = completed + failed + skipped;
  const remaining = Math.max(0, total - processed);

  // ETA is a rolling average of what this batch has actually taken, never a
  // guess dressed up as a measurement: with nothing finished it stays null and
  // the panel shows "hisoblanmoqda" instead of a fabricated countdown.
  const averageMs = processed > 0 ? Number(batch.duration_ms_total ?? 0) / processed : null;
  const running = ["queued", "running"].includes(batch.status as string);

  const current = rows.find((r) => (r.status as string) === "running");

  return {
    id: batchId,
    status: batch.status as string,
    total,
    completed,
    failed,
    skipped,
    processed,
    percent: total > 0 ? Math.round((processed / total) * 100) : 0,
    currentName: current ? nameById.get(current.intake_id as string) ?? null : null,
    currentStage: current?.current_stage ? stageLabel(current.current_stage as string) : null,
    elapsedMs: batch.started_at
      ? (batch.finished_at ? new Date(batch.finished_at as string).getTime() : Date.now()) -
        new Date(batch.started_at as string).getTime()
      : 0,
    etaMs: running && remaining > 0 ? Math.round((averageMs ?? DEFAULT_ITEM_DURATION_MS) * remaining) : null,
    startedAt: (batch.started_at as string | null) ?? null,
    finishedAt: (batch.finished_at as string | null) ?? null,
    items: rows.map((r) => ({
      id: r.id as string,
      intakeId: r.intake_id as string,
      fullName: nameById.get(r.intake_id as string) ?? "—",
      position: Number(r.position ?? 0),
      status: r.status as string,
      stage: r.current_stage ? stageLabel(r.current_stage as string) : null,
      error: (r.error as string | null) ?? null,
      telegramSent: Number(r.telegram_sent ?? 0),
      candidateSlug: r.candidate_id ? slugById.get(r.candidate_id as string) ?? null : null,
      postId: (r.post_id as string | null) ?? null,
    })),
  };
}

/** The batch the panel should be watching, if any. */
export async function getActiveBatchId(): Promise<string | null> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("intake_publish_batches")
    .select("id")
    .in("status", ["queued", "running", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function getLatestBatchId(): Promise<string | null> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("intake_publish_batches")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/* ------------------------------------------------------------------ *
 * Bot tugmasi
 * ------------------------------------------------------------------ */

/**
 * The bot's "Chop etishga tayyorlar" button.
 *
 * One button, two meanings, decided by what is actually happening: with a run
 * in flight it reports on that run, otherwise it starts one. A separate
 * "status" button would be dead weight most of the time, and two buttons that
 * both start batches would be a way to start two.
 *
 * The batch it starts is the SAME queue the admin panel drives — same table,
 * same worker, same order — so a run started here is visible there and vice
 * versa. Authorization is the router's job: only configured editorial chats
 * ever reach this.
 */
export async function runBotBatchButton(): Promise<string> {
  const activeId = await getActiveBatchId();
  if (activeId) {
    const progress = await getBatchProgress(activeId);
    if (progress) return renderProgress(progress);
  }

  const created = await createPublishBatch(null, null);
  if (!created.ok || !created.batchId) {
    // "Nothing eligible" is the ordinary case, not an error: it means every
    // paid candidate is already published.
    return created.error?.includes("topilmadi")
      ? buildNothingToPublishText()
      : `⚠️ ${created.error ?? "Batch boshlanmadi"}`;
  }
  return buildBatchStartedText(created.total ?? 0);
}

/** The most recent run, whether or not it is still going. */
export async function buildLatestBatchReport(): Promise<string> {
  const latest = (await getActiveBatchId()) ?? (await getLatestBatchId());
  if (!latest) return buildNothingToPublishText();
  const progress = await getBatchProgress(latest);
  return progress ? renderProgress(progress) : buildNothingToPublishText();
}

function renderProgress(progress: BatchProgress): string {
  return buildBatchProgressText({
    status: progress.status,
    total: progress.total,
    completed: progress.completed,
    failed: progress.failed,
    remaining: Math.max(0, progress.total - progress.processed),
    percent: progress.percent,
    currentName: progress.currentName,
    currentStage: progress.currentStage,
    elapsedMs: progress.elapsedMs,
    etaMs: progress.etaMs,
  });
}

/* ------------------------------------------------------------------ *
 * Cancel & retry
 * ------------------------------------------------------------------ */

/**
 * Stops a batch after the current item.
 *
 * Only queued items are cancelled: the one already running owns a candidate
 * that is part-way through publishing, and tearing that down mid-stage is what
 * would leave a half-published article behind.
 */
export async function cancelBatch(batchId: string, actorId: string | null): Promise<void> {
  const db = createSupabaseAdminClient();
  await db
    .from("intake_publish_batch_items")
    .update({ status: "cancelled" })
    .eq("batch_id", batchId)
    .eq("status", "queued");
  await db
    .from("intake_publish_batches")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("id", batchId)
    .in("status", ["queued", "running", "paused"]);

  await logAudit({
    actorId,
    action: "intake.publish_batch_cancelled",
    entityType: "intake_publish_batches",
    entityId: batchId,
    severity: "warning",
  });
}

/** Re-queues only what failed; completed items are never touched. */
export async function retryBatchFailures(
  batchId: string,
  actorId: string | null,
): Promise<{ requeued: number }> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("intake_publish_batch_items")
    .update({ status: "queued", current_stage: null, error: null, finished_at: null })
    .eq("batch_id", batchId)
    .in("status", ["failed", "needs_review", "cancelled"])
    .select("id");

  const requeued = data?.length ?? 0;
  if (requeued > 0) {
    // Counters are recomputed rather than adjusted, so a repeated retry cannot
    // drift them below zero.
    const { count: failed } = await db
      .from("intake_publish_batch_items")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batchId)
      .eq("status", "failed");
    await db
      .from("intake_publish_batches")
      .update({ status: "running", failed: failed ?? 0, finished_at: null })
      .eq("id", batchId);
  }

  await logAudit({
    actorId,
    action: "intake.publish_batch_retried",
    entityType: "intake_publish_batches",
    entityId: batchId,
    metadata: { requeued },
  });
  return { requeued };
}
