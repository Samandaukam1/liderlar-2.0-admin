import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { resolvePublicWebUrl } from "./site-origin.ts";
import { buildTelegramCaption, captionExceedsLimit } from "./telegram-markdown.ts";
import {
  sendTelegramPhoto,
  TelegramSendError,
  type SentPhoto,
} from "./telegram-api.ts";
import { POST_DELIVERY_CHAT_IDS_KEY } from "./delivery-recipients.ts";

/**
 * Private Telegram delivery bot — CHIQUVCHI tomon.
 *
 * The bot is never added to a channel and holds no channel id: people subscribe
 * themselves with /start, and each finished post is sent to every active
 * subscriber's own chat with sendPhoto. The token stays server-side — nothing
 * in this module is importable from a client component.
 *
 * Transport (fetch, error shapes, keyboards) lives in telegram-api.ts; the
 * inbound conversation — commands, keyboards, callbacks — lives in
 * bot-router.ts. This module owns subscribers and delivery.
 */

/**
 * Where "ariza qoldiring" in every caption points when nothing overrides it.
 * The application form lives on the public site at this fixed path; it is not
 * derived from the poster's own origin, which may be a preview deployment.
 */
export const DEFAULT_APPLICATION_URL = "https://liderlar.uz/ariza_qoldirish";

export const TELEGRAM_SETTINGS_KEYS = {
  applicationUrl: "telegram_bot.application_url",
  instagramUrl: "telegram_bot.instagram_url",
  username: "telegram_bot.username",
  postDeliveryChatIds: POST_DELIVERY_CHAT_IDS_KEY,
} as const;

export interface TelegramSettings {
  /** Null until public_web.base_url (or its env override) is configured. */
  siteUrl: string | null;
  applicationUrl: string | null;
  instagramUrl: string;
  username: string;
}

/**
 * Caption links come from site_settings first and env second — never hardcoded,
 * and never from the request's own host, so a Vercel preview URL cannot leak
 * into a caption that thousands of subscribers receive.
 *
 * `siteUrl` resolves through public-web-url.ts, which has no domain fallback:
 * liderlar.uz still serves the OLD site, so guessing it would link every
 * subscriber to the wrong page. Unconfigured means "no caption yet".
 */
export async function getTelegramSettings(): Promise<TelegramSettings> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("site_settings")
    .select("key, value")
    .in("key", Object.values(TELEGRAM_SETTINGS_KEYS));

  const settings = new Map((data ?? []).map((r) => [r.key as string, (r.value as string) ?? ""]));
  const pick = (key: string, envValue: string | undefined, fallback: string) =>
    (settings.get(key) || envValue || fallback).trim();

  const siteUrl = await resolvePublicWebUrl();
  const applicationUrl = pick(
    TELEGRAM_SETTINGS_KEYS.applicationUrl,
    process.env.NEXT_PUBLIC_APPLICATION_URL,
    DEFAULT_APPLICATION_URL,
  );

  return {
    siteUrl,
    applicationUrl: applicationUrl || null,
    instagramUrl: pick(
      TELEGRAM_SETTINGS_KEYS.instagramUrl,
      process.env.NEXT_PUBLIC_INSTAGRAM_URL,
      "https://instagram.com/liderlar.uz",
    ),
    username: pick(TELEGRAM_SETTINGS_KEYS.username, process.env.TELEGRAM_BOT_USERNAME, "uzlye_rasmiy")
      .replace(/^@/, ""),
  };
}

/* ------------------------------------------------------------------ *
 * Delivery recipients
 * ------------------------------------------------------------------ */

/**
 * Guarantees a subscriber row for every configured recipient.
 *
 * Deliveries are recorded against `telegram_post_subscribers`, and that row is
 * what the "sent once" unique index keys on. A configured chat with no row
 * could therefore be sent the same post twice. For a private chat Telegram uses
 * the user's own id as the chat id, which is why one value seeds both columns.
 */
export async function ensureDeliverySubscribers(chatIds: number[]): Promise<void> {
  if (chatIds.length === 0) return;
  const db = createSupabaseAdminClient();
  const { data: existing } = await db
    .from("telegram_post_subscribers")
    .select("chat_id")
    .in("chat_id", chatIds);

  const known = new Set((existing ?? []).map((r) => Number(r.chat_id)));
  const missing = chatIds.filter((id) => !known.has(id));
  if (missing.length === 0) return;

  const { error } = await db.from("telegram_post_subscribers").upsert(
    missing.map((id) => ({
      telegram_user_id: id,
      chat_id: id,
      is_active: true,
      first_name: "Tahririyat",
    })),
    { onConflict: "telegram_user_id" },
  );
  if (error) {
    console.error("[telegram] delivery subscriber seed failed", error.message);
  }
}

/* ------------------------------------------------------------------ *
 * Subscribers
 * ------------------------------------------------------------------ */

export interface TelegramFrom {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}

/**
 * Idempotent subscribe. `telegram_user_id` is unique, so a second /start
 * updates the existing row (and re-activates it) instead of inserting a
 * duplicate.
 */
export async function upsertSubscriber(from: TelegramFrom, chatId: number): Promise<void> {
  const db = createSupabaseAdminClient();
  const { error } = await db.from("telegram_post_subscribers").upsert(
    {
      telegram_user_id: from.id,
      chat_id: chatId,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
      language_code: from.language_code ?? null,
      is_active: true,
      started_at: new Date().toISOString(),
      stopped_at: null,
    },
    { onConflict: "telegram_user_id" },
  );
  if (error) {
    // code/details/hint are what distinguish "table missing" (unapplied
    // migration) from a constraint problem; the message alone is not enough.
    console.error(
      "[telegram-webhook] upsert error",
      JSON.stringify({ code: error.code, message: error.message, details: error.details, hint: error.hint }),
    );
    throw new Error(`Obunachini saqlab bo‘lmadi: ${error.message}`);
  }
}

export async function deactivateSubscriber(telegramUserId: number): Promise<void> {
  const db = createSupabaseAdminClient();
  await db
    .from("telegram_post_subscribers")
    .update({ is_active: false, stopped_at: new Date().toISOString() })
    .eq("telegram_user_id", telegramUserId);
}

async function deactivateSubscriberById(subscriberId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  await db
    .from("telegram_post_subscribers")
    .update({ is_active: false, stopped_at: new Date().toISOString() })
    .eq("id", subscriberId);
}

export interface SubscriberStats {
  total: number;
  active: number;
  stopped: number;
  lastSentAt: string | null;
}

export async function getSubscriberStats(): Promise<SubscriberStats> {
  const db = createSupabaseAdminClient();
  const [{ count: total }, { count: active }, { data: last }] = await Promise.all([
    db.from("telegram_post_subscribers").select("id", { count: "exact", head: true }),
    db
      .from("telegram_post_subscribers")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    db
      .from("telegram_post_subscribers")
      .select("last_sent_at")
      .not("last_sent_at", "is", null)
      .order("last_sent_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    total: total ?? 0,
    active: active ?? 0,
    stopped: (total ?? 0) - (active ?? 0),
    lastSentAt: (last?.last_sent_at as string | null) ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Delivery
 * ------------------------------------------------------------------ */

export interface DeliveryResult {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  errors: { subscriberId: string; error: string }[];
}

export interface DeliverOptions {
  /** Re-send only to subscribers whose last attempt for this post failed. */
  onlyFailed?: boolean;
  actorId?: string | null;
  /**
   * Restrict the fan-out to these chats. Automated runs pass the configured
   * editorial recipients so a batch cannot post to the whole subscriber list;
   * omitting it keeps the manual "send to everyone" behaviour.
   */
  chatIds?: number[];
  /**
   * Deliberately send this post again to chats that already have it.
   *
   * This is the one path that bypasses the "sent once" guarantee, so it is
   * never reached by a retry, a cron tick or a batch — only by an admin who
   * confirmed it. The prior `sent` rows are cleared first: the partial unique
   * index would otherwise reject the second insert, and leaving them would make
   * the delivery history claim two simultaneous sends.
   */
  force?: boolean;
}

/**
 * Sends one rendered post to every active subscriber.
 *
 * A failure for one chat never stops the run; permanent failures (blocked bot,
 * chat gone) deactivate that subscriber. Anyone who already has a `sent` row
 * for this post is skipped, so a re-run cannot double-post.
 */
/**
 * Telegram allows a bot roughly 30 messages a second overall. Pacing just under
 * that keeps a large batch out of the flood limiter entirely, which is far
 * cheaper than being throttled and retrying.
 */
const SEND_INTERVAL_MS = 40;
/** Attempts per subscriber for errors Telegram says are temporary. */
const MAX_SEND_ATTEMPTS = 3;
/** Never sleep longer than this on a `retry_after`, to stay inside the run. */
const MAX_RETRY_WAIT_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One subscriber, with the flood limit honoured.
 *
 * A 429 carries Telegram's own `retry_after`; waiting exactly that long and
 * trying again is the documented way through it. Anything permanent, or a
 * transient error that survives every attempt, is thrown to the caller.
 */
async function sendWithRetry(
  chatId: number,
  photo: Buffer | string,
  caption: string,
): Promise<SentPhoto> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await sendTelegramPhoto(chatId, photo, caption);
    } catch (err) {
      const error = err instanceof TelegramSendError ? err : null;
      if (!error?.isTransient || attempt >= MAX_SEND_ATTEMPTS) throw err;
      const wait = Math.min((error.retryAfter ?? attempt) * 1000, MAX_RETRY_WAIT_MS);
      await sleep(wait);
    }
  }
}

export async function deliverPostToSubscribers(
  postId: string,
  photo: Buffer,
  caption: string,
  options: DeliverOptions = {},
): Promise<DeliveryResult> {
  const db = createSupabaseAdminClient();

  if (captionExceedsLimit(caption)) {
    throw new Error(
      `Telegram caption ${[...caption].length} belgidan iborat — 1024 chegarasidan oshdi.`,
    );
  }

  // A restricted run seeds its recipients first, so a configured editor who
  // never pressed /start still gets the post — and still gets a delivery row,
  // which is what makes the "sent once" guarantee hold for them too.
  if (options.chatIds?.length) await ensureDeliverySubscribers(options.chatIds);

  let subscriberQuery = db
    .from("telegram_post_subscribers")
    .select("id, chat_id, telegram_user_id")
    .eq("is_active", true);
  if (options.chatIds?.length) {
    subscriberQuery = subscriberQuery.in("chat_id", options.chatIds);
  }

  const [{ data: subscribers }, { data: deliveries }] = await Promise.all([
    subscriberQuery,
    db.from("telegram_post_deliveries").select("subscriber_id, status").eq("post_id", postId),
  ]);

  // A forced resend treats nobody as already served. The old `sent` rows are
  // dropped so the partial unique index accepts the new ones; the audit entry
  // below is what records that this happened.
  const alreadySent = options.force
    ? new Set<string>()
    : new Set(
        (deliveries ?? []).filter((d) => d.status === "sent").map((d) => d.subscriber_id as string),
      );

  if (options.force) {
    const recipients = (subscribers ?? []).map((s) => s.id as string);
    if (recipients.length > 0) {
      await db
        .from("telegram_post_deliveries")
        .delete()
        .eq("post_id", postId)
        .in("subscriber_id", recipients);
    }
  }
  const previouslyFailed = new Set(
    (deliveries ?? []).filter((d) => d.status === "failed").map((d) => d.subscriber_id as string),
  );

  const result: DeliveryResult = { attempted: 0, sent: 0, failed: 0, skipped: 0, errors: [] };
  const rows: Record<string, unknown>[] = [];
  const sentSubscriberIds: string[] = [];

  // Set by the first successful send; every later one references the image
  // Telegram already holds instead of re-uploading it.
  let uploaded: string | null = null;
  let previousSendAt = 0;

  for (const subscriber of subscribers ?? []) {
    const id = subscriber.id as string;

    if (alreadySent.has(id)) {
      result.skipped += 1;
      continue;
    }
    if (options.onlyFailed && !previouslyFailed.has(id)) {
      result.skipped += 1;
      continue;
    }

    // Pace against the bot-wide rate limit, measured from the last send rather
    // than slept unconditionally, so a slow upload does not add to the gap.
    const sinceLast = Date.now() - previousSendAt;
    if (previousSendAt > 0 && sinceLast < SEND_INTERVAL_MS) {
      await sleep(SEND_INTERVAL_MS - sinceLast);
    }

    result.attempted += 1;
    try {
      const sent = await sendWithRetry(subscriber.chat_id as number, uploaded ?? photo, caption);
      previousSendAt = Date.now();
      uploaded = uploaded ?? sent.fileId;
      result.sent += 1;
      sentSubscriberIds.push(id);
      rows.push({
        post_id: postId,
        subscriber_id: id,
        telegram_message_id: sent.messageId,
        status: "sent",
      });
    } catch (err) {
      previousSendAt = Date.now();
      const error = err instanceof TelegramSendError ? err : null;
      const message = err instanceof Error ? err.message : String(err);
      result.failed += 1;
      result.errors.push({ subscriberId: id, error: message });
      rows.push({ post_id: postId, subscriber_id: id, status: "failed", error: message });

      if (error?.isPermanent) await deactivateSubscriberById(id);
    }
  }

  if (rows.length > 0) {
    // A failed row for a subscriber that later succeeded must not violate the
    // "sent once" unique index, which is why that index is partial on 'sent'.
    await db.from("telegram_post_deliveries").insert(rows);
  }
  if (sentSubscriberIds.length > 0) {
    await db
      .from("telegram_post_subscribers")
      .update({ last_sent_at: new Date().toISOString() })
      .in("id", sentSubscriberIds);
  }

  await logAudit({
    actorId: options.actorId ?? null,
    action: options.force ? "post.telegram_force_resent" : "post.telegram_delivered",
    entityType: "candidate_social_posts",
    entityId: postId,
    // A forced resend is always worth a second look in the log: it is the only
    // way a subscriber receives the same post twice.
    severity: options.force || result.failed > 0 ? "warning" : "info",
    metadata: {
      ...result,
      onlyFailed: Boolean(options.onlyFailed),
      forced: Boolean(options.force),
    },
  });

  return result;
}

/** Per-post delivery tallies for the studio panel. */
export async function getPostDeliveryStats(postId: string): Promise<{
  sent: number;
  failed: number;
  lastSentAt: string | null;
}> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("telegram_post_deliveries")
    .select("status, sent_at")
    .eq("post_id", postId)
    .order("sent_at", { ascending: false });

  const rows = data ?? [];
  // A subscriber that failed and was later retried successfully counts once.
  return {
    sent: rows.filter((r) => r.status === "sent").length,
    failed: rows.filter((r) => r.status === "failed").length,
    lastSentAt: (rows[0]?.sent_at as string | undefined) ?? null,
  };
}

export { buildTelegramCaption };
export { parseTelegramCommand } from "./telegram-command.ts";

// Transport moved to telegram-api.ts; re-exported so every existing importer
// (routes, scheduler, server actions) keeps its single entry point.
export {
  answerCallbackQuery,
  botToken,
  editTelegramMessageText,
  isTelegramConfigured,
  sendTelegramMessage,
  sendTelegramPhoto,
  TelegramSendError,
} from "./telegram-api.ts";
export type { SentPhoto } from "./telegram-api.ts";
export { getPostDeliveryChatIds } from "./delivery-recipients.ts";
