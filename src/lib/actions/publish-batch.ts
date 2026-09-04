"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import {
  cancelBatch,
  createPublishBatch,
  getBatchProgress,
  retryBatchFailures,
  type BatchProgress,
} from "@/lib/intake/publish-batch";
import { askPaymentForIntakes, type PaymentAskChunkResult } from "@/lib/intake/payment";
import { parseCalendarDate } from "@/lib/tashkent-day";

/**
 * Batch nashr va to'lov so'rovi uchun server action'lar.
 *
 * Har biri `requirePermission` bilan boshlanadi — bu chaqiruvlar public API
 * emas, va cron endpoint'idan farqli o'laroq sessiya bilan himoyalangan.
 * Og'ir ishning o'zi bu yerda BAJARILMAYDI: action faqat navbat yaratadi,
 * ishni esa claim-lock ostidagi worker bajaradi.
 */

const QUEUE_PATH = "/nomzodlar/anketalar/chop-etishga-tayyorlar";

export interface BatchActionResult {
  ok: boolean;
  error?: string;
  batchId?: string;
  total?: number;
  requeued?: number;
}

/**
 * Queues today's paid candidates, or only the ticked ones.
 *
 * `null` means "everything eligible today"; an explicit list means selection
 * mode was on. Passing an empty array is treated as an error rather than
 * silently falling back to all — that fallback is how a stray click would
 * publish two dozen people.
 */
export async function startPublishBatchAction(
  intakeIds: string[] | null,
  date?: string | null,
): Promise<BatchActionResult> {
  const ctx = await requirePermission("intakes.publish");
  if (intakeIds !== null && intakeIds.length === 0) {
    return { ok: false, error: "Hech kim tanlanmagan." };
  }

  // The date is validated rather than trusted: it reaches the day-range helper,
  // and a malformed value there would silently widen or empty the query.
  const day = date ? parseCalendarDate(date) : null;
  if (date && !day) return { ok: false, error: "Sana noto‘g‘ri." };

  const result = await createPublishBatch(intakeIds, ctx.userId, day);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(QUEUE_PATH);
  return { ok: true, batchId: result.batchId, total: result.total };
}

export async function cancelPublishBatchAction(batchId: string): Promise<BatchActionResult> {
  const ctx = await requirePermission("intakes.publish");
  await cancelBatch(batchId, ctx.userId);
  revalidatePath(QUEUE_PATH);
  return { ok: true };
}

export async function retryPublishBatchAction(batchId: string): Promise<BatchActionResult> {
  const ctx = await requirePermission("intakes.publish");
  const { requeued } = await retryBatchFailures(batchId, ctx.userId);
  revalidatePath(QUEUE_PATH);
  return { ok: true, requeued };
}

/** Polled by the progress panel; read-only, so `intakes.view` is enough. */
export async function getBatchProgressAction(batchId: string): Promise<BatchProgress | null> {
  await requirePermission("intakes.view");
  return getBatchProgress(batchId);
}

/**
 * Asks the editorial chats about one chunk of candidates.
 *
 * Chunked on purpose: the panel drives the loop and advances its progress bar
 * from real completions, so the bar measures work that actually happened
 * instead of animating a guess.
 */
export async function askPaymentChunkAction(
  intakeIds: string[],
): Promise<PaymentAskChunkResult> {
  await requirePermission("intakes.review");
  return askPaymentForIntakes(intakeIds);
}
