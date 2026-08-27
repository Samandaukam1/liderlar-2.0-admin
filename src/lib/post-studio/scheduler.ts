import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getPost, updatePost } from "./repository.ts";
import { downloadPostAsset } from "./storage.ts";
import { deliverPostToSubscribers, isTelegramConfigured } from "./telegram.ts";

/**
 * Sends posts whose scheduled time has arrived.
 *
 * "Rejalashtirish" would otherwise only store a date that nothing ever acts
 * on, so this runs off the same Vercel Cron tick as the two-hour pipeline.
 * Delivery itself is idempotent (a subscriber with a `sent` row is skipped),
 * which means a cron retry after a partial send resumes rather than duplicates.
 */

export const SCHEDULED_BATCH_SIZE = 5;

export interface ScheduledSendResult {
  postId: string;
  ok: boolean;
  sent?: number;
  failed?: number;
  error?: string;
}

export async function sendDueScheduledPosts(
  limit = SCHEDULED_BATCH_SIZE,
): Promise<ScheduledSendResult[]> {
  if (!isTelegramConfigured()) return [];

  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("candidate_social_posts")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  const results: ScheduledSendResult[] = [];

  for (const row of data ?? []) {
    const postId = row.id as string;
    const post = await getPost(postId);
    if (!post) continue;

    if (!post.telegramCaption) {
      await updatePost(postId, {
        status: "needs_review",
        error: "Rejalashtirilgan post caption'siz — yuborilmadi.",
      });
      results.push({ postId, ok: false, error: "caption yo‘q" });
      continue;
    }

    const photo = await downloadPostAsset(post.candidateId, "render");
    if (!photo) {
      await updatePost(postId, {
        status: "needs_review",
        error: "Rejalashtirilgan post renderi topilmadi.",
      });
      results.push({ postId, ok: false, error: "render yo‘q" });
      continue;
    }

    try {
      const delivery = await deliverPostToSubscribers(postId, photo, post.telegramCaption, {
        actorId: null,
      });
      await updatePost(postId, {
        status: delivery.sent > 0 ? "published" : "needs_review",
        published_at: delivery.sent > 0 ? new Date().toISOString() : null,
        telegram_last_sent_at: new Date().toISOString(),
        telegram_sent_count: post.telegramSentCount + delivery.sent,
        telegram_failed_count: delivery.failed,
        error: delivery.sent > 0 ? null : "Hech bir obunachiga yuborilmadi.",
      });
      results.push({ postId, ok: true, sent: delivery.sent, failed: delivery.failed });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updatePost(postId, { status: "failed", error: message });
      await logAudit({
        actorId: null,
        action: "post.scheduled_send_failed",
        entityType: "candidate_social_posts",
        entityId: postId,
        severity: "critical",
        metadata: { error: message },
      });
      results.push({ postId, ok: false, error: message });
    }
  }

  return results;
}
