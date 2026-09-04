import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { resolvePublicWebUrl } from "./site-origin.ts";
import { buildTelegramCaption, captionExceedsLimit } from "./telegram-markdown.ts";
import { parseTelegramCommand } from "./telegram-command.ts";
import {
  answerCallbackQuery,
  sendTelegramMessage,
  sendTelegramPhoto,
  TelegramSendError,
  type SentPhoto,
} from "./telegram-api.ts";
import {
  buildBotStatusReport,
  handlePaymentCallback,
  parsePaymentCallback,
  REPORT_BUTTON_LABEL,
} from "@/lib/intake/payment.ts";
import { POST_DELIVERY_CHAT_IDS_KEY } from "./delivery-recipients.ts";

/**
 * Private Telegram delivery bot.
 *
 * The bot is never added to a channel and holds no channel id: people subscribe
 * themselves with /start, and each finished post is sent to every active
 * subscriber's own chat with sendPhoto. The token stays server-side — nothing
 * in this module is importable from a client component.
 *
 * Transport (fetch, error shapes, keyboards) lives in telegram-api.ts; this
 * module owns subscribers, delivery and update handling.
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

export const START_REPLY = [
  "Assalomu alaykum! 👋",
  "",
  "Siz O‘zbekiston Lider Yoshlari post yetkazib beruvchi botiga muvaffaqiyatli ulandingiz.",
  "",
  "Endi LIDERLAR.UZ ensiklopediyasida yangi lider maqolasi va posti e’lon qilinganda, tayyor postlarni shu yerda qabul qilishingiz mumkin.",
  "",
  "Obunani to‘xtatish: /stop",
].join("\n");

export const STOP_REPLY =
  "Post xabarnomalari to‘xtatildi. Qayta ulanish uchun /start yuboring.";

/** Anything that is not a known command still gets an answer. */
export const HELP_REPLY = [
  "Botdan foydalanish uchun:",
  "/start — postlarni olish",
  "/stop — postlarni to‘xtatish",
].join("\n");

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

export interface TelegramUpdate {
  message?: {
    chat?: { id?: number };
    from?: TelegramFrom;
    text?: string;
  };
  callback_query?: {
    id: string;
    from?: TelegramFrom;
    data?: string;
    message?: { chat?: { id?: number }; message_id?: number };
  };
}

/** The persistent keyboard every subscriber sees under the input box. */
const BOT_KEYBOARD = [[REPORT_BUTTON_LABEL]];

/**
 * Handles one webhook update.
 *
 * The subscriber write is deliberately non-fatal. It used to run as
 * `await upsertSubscriber(...)` directly in front of the reply, so any database
 * problem — a missing migration, an RLS change, a transient PostgREST error —
 * threw before sendMessage was ever reached and the user got total silence
 * while Telegram still saw a 200. The reply now goes out regardless, and the
 * database failure is logged loudly instead of swallowing the conversation.
 */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  // A tapped inline button arrives as a callback_query, not a message. This is
  // how the payment question is answered, so it is checked first.
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  const from = message?.from;

  if (!chatId || !from?.id) {
    console.log("[telegram-webhook] update ignored: no chat or sender");
    return;
  }

  const command = parseTelegramCommand(message?.text);
  console.log(`[telegram-webhook] command=${command || "(none)"}`);

  if (command === "/start") {
    try {
      await upsertSubscriber(from, chatId);
      console.log("[telegram-webhook] subscriber upserted");
    } catch (err) {
      console.error(
        "[telegram-webhook] subscriber upsert failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
    await sendTelegramMessage(chatId, START_REPLY, { replyKeyboard: BOT_KEYBOARD });
    console.log("[telegram-webhook] sendMessage success command=/start");
    return;
  }

  if (command === "/stop") {
    try {
      await deactivateSubscriber(from.id);
      console.log("[telegram-webhook] subscriber deactivated");
    } catch (err) {
      console.error(
        "[telegram-webhook] subscriber deactivate failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
    await sendTelegramMessage(chatId, STOP_REPLY);
    console.log("[telegram-webhook] sendMessage success command=/stop");
    return;
  }

  // The report is reachable both as a typed command and as the keyboard button,
  // because a button press arrives as an ordinary message carrying its label.
  if (command === "/hisobot" || (message?.text ?? "").trim() === REPORT_BUTTON_LABEL) {
    const report = await buildBotStatusReport();
    await sendTelegramMessage(chatId, report, { replyKeyboard: BOT_KEYBOARD });
    console.log("[telegram-webhook] sendMessage success command=report");
    return;
  }

  // Never leave a message unanswered.
  await sendTelegramMessage(chatId, HELP_REPLY, { replyKeyboard: BOT_KEYBOARD });
  console.log("[telegram-webhook] sendMessage success command=help");
}

/**
 * One tapped inline button.
 *
 * The spinner is cleared first and the slow work runs after: Telegram keeps the
 * button spinning for a few seconds and shows the tapper an error if nothing
 * answers, regardless of what the handler is still doing.
 */
async function handleCallbackQuery(
  query: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  const payment = parsePaymentCallback(query.data);
  if (!payment) {
    await answerCallbackQuery(query.id);
    console.log("[telegram-webhook] callback ignored: unknown data");
    return;
  }

  const outcome = await handlePaymentCallback({
    intakeId: payment.intakeId,
    paid: payment.paid,
    chatId: query.message?.chat?.id ?? null,
    messageId: query.message?.message_id ?? null,
    fromUserId: query.from?.id ?? null,
    callbackQueryId: query.id,
  });
  console.log(`[telegram-webhook] payment callback ${payment.paid ? "yes" : "no"} → ${outcome}`);
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

  const alreadySent = new Set(
    (deliveries ?? []).filter((d) => d.status === "sent").map((d) => d.subscriber_id as string),
  );
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
    action: "post.telegram_delivered",
    entityType: "candidate_social_posts",
    entityId: postId,
    severity: result.failed > 0 ? "warning" : "info",
    metadata: { ...result, onlyFailed: Boolean(options.onlyFailed) },
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
export { parseTelegramCommand };

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
