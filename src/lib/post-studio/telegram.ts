import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { resolvePublicWebUrl } from "./site-origin.ts";
import { buildTelegramCaption, captionExceedsLimit } from "./telegram-markdown.ts";
import { parseTelegramCommand } from "./telegram-command.ts";

/**
 * Private Telegram delivery bot.
 *
 * The bot is never added to a channel and holds no channel id: people subscribe
 * themselves with /start, and each finished post is sent to every active
 * subscriber's own chat with sendPhoto. The token stays server-side — nothing
 * in this module is importable from a client component.
 */

const TELEGRAM_API = "https://api.telegram.org";

export const TELEGRAM_SETTINGS_KEYS = {
  applicationUrl: "telegram_bot.application_url",
  instagramUrl: "telegram_bot.instagram_url",
  username: "telegram_bot.username",
} as const;

export interface TelegramSettings {
  /** Null until public_web.base_url (or its env override) is configured. */
  siteUrl: string | null;
  applicationUrl: string | null;
  instagramUrl: string;
  username: string;
}

export function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN sozlanmagan.");
  return token;
}

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
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
    siteUrl ? `${siteUrl}/ariza` : "",
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
 * Bot API
 * ------------------------------------------------------------------ */

export interface TelegramApiError {
  errorCode: number;
  description: string;
}

export class TelegramSendError extends Error {
  /** Plain field, not a parameter property — see PortraitProcessingError. */
  readonly errorCode: number;

  constructor(message: string, errorCode: number) {
    super(message);
    this.name = "TelegramSendError";
    this.errorCode = errorCode;
  }

  /**
   * Errors that mean this chat can never receive another message: the user
   * blocked the bot, deleted their account, or the chat is gone. The
   * subscriber is deactivated rather than retried forever.
   */
  get isPermanent(): boolean {
    if (this.errorCode === 403) return true;
    return this.errorCode === 400 && /chat not found|user is deactivated/i.test(this.message);
  }
}

async function callTelegram<T>(method: string, body: FormData | Record<string, unknown>): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await fetch(`${TELEGRAM_API}/bot${botToken()}/${method}`, {
    method: "POST",
    headers: isForm ? undefined : { "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body),
  });

  const raw = await response.text();
  let payload: { ok: boolean; result?: T; description?: string; error_code?: number } | null = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }

  if (!payload?.ok) {
    // The API's own description is the only thing that explains a 400 ("chat
    // not found", "can't parse entities", ...), so it has to reach the logs.
    // The URL is never logged — it carries the bot token.
    console.error(
      `[telegram-api] ${method} failed status=${response.status} body=${raw.slice(0, 500)}`,
    );
    throw new TelegramSendError(
      payload?.description ?? `Telegram ${method} xatosi (${response.status})`,
      payload?.error_code ?? response.status,
    );
  }
  return payload.result as T;
}

export async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  await callTelegram("sendMessage", { chat_id: chatId, text });
}

export async function sendTelegramPhoto(
  chatId: number,
  photo: Buffer,
  caption: string,
): Promise<number> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append("parse_mode", "MarkdownV2");
  form.append("photo", new Blob([new Uint8Array(photo)], { type: "image/png" }), "post.png");

  const result = await callTelegram<{ message_id: number }>("sendPhoto", form);
  return result.message_id;
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
}

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
    await sendTelegramMessage(chatId, START_REPLY);
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

  // Never leave a message unanswered.
  await sendTelegramMessage(chatId, HELP_REPLY);
  console.log("[telegram-webhook] sendMessage success command=help");
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
}

/**
 * Sends one rendered post to every active subscriber.
 *
 * A failure for one chat never stops the run; permanent failures (blocked bot,
 * chat gone) deactivate that subscriber. Anyone who already has a `sent` row
 * for this post is skipped, so a re-run cannot double-post.
 */
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

  const [{ data: subscribers }, { data: deliveries }] = await Promise.all([
    db
      .from("telegram_post_subscribers")
      .select("id, chat_id, telegram_user_id")
      .eq("is_active", true),
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

    result.attempted += 1;
    try {
      const messageId = await sendTelegramPhoto(subscriber.chat_id as number, photo, caption);
      result.sent += 1;
      sentSubscriberIds.push(id);
      rows.push({
        post_id: postId,
        subscriber_id: id,
        telegram_message_id: messageId,
        status: "sent",
      });
    } catch (err) {
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
