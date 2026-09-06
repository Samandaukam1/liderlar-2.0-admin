import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getCandidateInstagramUsername } from "@/lib/intake/instagram-link";
import { buildInstagramFollowUpText } from "./instagram-followup-message.ts";
import { isTelegramConfigured, sendTelegramMessage } from "./telegram-api.ts";

/**
 * The Instagram note that follows a delivered post.
 *
 * A candidate who gave an Instagram handle gets one extra message straight
 * after their poster lands in Telegram, so the editor can tag them in the
 * collaboration post without going back to the panel. No handle means no
 * message at all — never an empty or "—" placeholder.
 *
 * SENT AT MOST ONCE PER POST. The cron pipeline, the batch and a manual retry
 * all re-enter the same delivery path, so the guard cannot be a `select` +
 * `send`: two overlapping runs would both read "not sent yet". Instead the run
 * CLAIMS the post by stamping `instagram_followup_sent_at` with a
 * `is null` guard on the update itself, and only the run whose update returned
 * a row proceeds — the same lock the pipeline uses for `post_pipeline_status`.
 * The claim is released only when every send failed, so a Telegram outage stays
 * retryable while a partial success never sends twice.
 */

export interface InstagramFollowUpResult {
  /** Chats the note actually reached. */
  sent: number;
  /** Why nothing was sent, when nothing was. */
  skipped:
    | "already_sent"
    | "no_instagram"
    | "no_recipients"
    | "telegram_unconfigured"
    | null;
}

const nothing = (skipped: InstagramFollowUpResult["skipped"]): InstagramFollowUpResult => ({
  sent: 0,
  skipped,
});

/** Chats that actually received this post — the note goes to exactly those. */
async function recipientsOfPost(postId: string): Promise<number[]> {
  const db = createSupabaseAdminClient();
  const { data: deliveries } = await db
    .from("telegram_post_deliveries")
    .select("subscriber_id")
    .eq("post_id", postId)
    .eq("status", "sent");

  const subscriberIds = [...new Set((deliveries ?? []).map((d) => d.subscriber_id as string))];
  if (subscriberIds.length === 0) return [];

  const { data: subscribers } = await db
    .from("telegram_post_subscribers")
    .select("chat_id")
    .in("id", subscriberIds);

  return [...new Set((subscribers ?? []).map((s) => Number(s.chat_id)))].filter((id) =>
    Number.isSafeInteger(id) && id !== 0,
  );
}

/** Takes the "this post's note is mine to send" lock, or reports it taken. */
async function claim(postId: string): Promise<boolean> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("candidate_social_posts")
    .update({ instagram_followup_sent_at: new Date().toISOString() })
    .eq("id", postId)
    .is("instagram_followup_sent_at", null)
    .select("id");
  return (data?.length ?? 0) > 0;
}

async function releaseClaim(postId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  await db
    .from("candidate_social_posts")
    .update({ instagram_followup_sent_at: null })
    .eq("id", postId);
}

export async function sendInstagramFollowUp(
  postId: string,
  candidateId: string,
): Promise<InstagramFollowUpResult> {
  if (!isTelegramConfigured()) return nothing("telegram_unconfigured");

  const username = await getCandidateInstagramUsername(candidateId);
  if (!username) return nothing("no_instagram");

  const chatIds = await recipientsOfPost(postId);
  if (chatIds.length === 0) return nothing("no_recipients");

  if (!(await claim(postId))) return nothing("already_sent");

  const text = buildInstagramFollowUpText(username);
  let sent = 0;
  for (const chatId of chatIds) {
    try {
      await sendTelegramMessage(chatId, text);
      sent += 1;
    } catch (err) {
      console.error(
        `[instagram-followup] send failed post=${postId}`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Nothing got through: this was an outage, not a delivery. Hand the claim
  // back so the next run can try again — a partial success keeps it.
  if (sent === 0) {
    await releaseClaim(postId);
    return nothing("no_recipients");
  }

  await logAudit({
    actorId: null,
    action: "post.instagram_followup_sent",
    entityType: "candidate_social_posts",
    entityId: postId,
    metadata: { candidateId, chats: chatIds.length, sent },
  });

  return { sent, skipped: null };
}

export { buildInstagramFollowUpText };
