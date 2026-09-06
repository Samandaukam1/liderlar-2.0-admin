import "server-only";

/**
 * Bot API transport — bu qatlamda biznes-logika YO'Q.
 *
 * telegram.ts (obunachilar, yetkazish) va intake/payment.ts (to'lov savoli)
 * ikkalasi ham shu yerdan yuboradi. Transport alohida turgani uchun ular
 * bir-birini import qilmaydi — aylanma import (import cycle) umuman
 * yuzaga kelmaydi.
 *
 * Token faqat shu yerda o'qiladi va hech qachon log'ga yozilmaydi.
 */

const TELEGRAM_API = "https://api.telegram.org";

export function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN sozlanmagan.");
  return token;
}

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export class TelegramSendError extends Error {
  /** Plain field, not a parameter property — see PortraitProcessingError. */
  readonly errorCode: number;
  /** Seconds Telegram asked us to wait, from a 429's `parameters`. */
  readonly retryAfter: number | null;

  constructor(message: string, errorCode: number, retryAfter: number | null = null) {
    super(message);
    this.retryAfter = retryAfter;
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

  /**
   * Worth trying again: Telegram's flood limit (429) and its own server
   * errors. Recording these as a permanent failure is what made a large batch
   * reach only the first few dozen subscribers.
   */
  get isTransient(): boolean {
    return this.errorCode === 429 || this.errorCode >= 500;
  }
}

export async function callTelegram<T>(
  method: string,
  body: FormData | Record<string, unknown>,
): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await fetch(`${TELEGRAM_API}/bot${botToken()}/${method}`, {
    method: "POST",
    headers: isForm ? undefined : { "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body),
  });

  const raw = await response.text();
  let payload: {
    ok: boolean;
    result?: T;
    description?: string;
    error_code?: number;
    parameters?: { retry_after?: number };
  } | null = null;
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
      payload?.parameters?.retry_after ?? null,
    );
  }
  return payload.result as T;
}

/* ------------------------------------------------------------------ *
 * Keyboards
 * ------------------------------------------------------------------ */

export interface InlineButton {
  text: string;
  /** Max 64 bytes — Telegram rejects anything longer. */
  callback_data: string;
}

export interface SendMessageOptions {
  /** Rows of inline buttons attached under the message. */
  inlineKeyboard?: InlineButton[][];
  /** Persistent keyboard shown in place of the user's input suggestions. */
  replyKeyboard?: string[][];
  parseMode?: "MarkdownV2" | "HTML";
  disableWebPagePreview?: boolean;
}

function replyMarkup(options: SendMessageOptions): Record<string, unknown> | undefined {
  if (options.inlineKeyboard) {
    return { inline_keyboard: options.inlineKeyboard };
  }
  if (options.replyKeyboard) {
    return {
      keyboard: options.replyKeyboard.map((row) => row.map((text) => ({ text }))),
      resize_keyboard: true,
      is_persistent: true,
    };
  }
  return undefined;
}

export interface SentMessage {
  messageId: number;
}

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  options: SendMessageOptions = {},
): Promise<SentMessage> {
  const result = await callTelegram<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
    ...(options.disableWebPagePreview
      ? { link_preview_options: { is_disabled: true } }
      : {}),
    ...(replyMarkup(options) ? { reply_markup: replyMarkup(options) } : {}),
  });
  return { messageId: result.message_id };
}

/**
 * Rewrites a message in place.
 *
 * With no keyboard given the buttons are DROPPED, which is the answered-question
 * case: the same question goes to several chats at once, and once anyone
 * answers, the copies still showing live buttons are stale. Passing a keyboard
 * replaces them instead — that is how a paged list moves to the next page
 * without adding a new message to the chat for every tap.
 */
export async function editTelegramMessageText(
  chatId: number,
  messageId: number,
  text: string,
  options: { inlineKeyboard?: InlineButton[][] } = {},
): Promise<void> {
  await callTelegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: { inline_keyboard: options.inlineKeyboard ?? [] },
  });
}

/**
 * Clears the spinner on a tapped inline button.
 *
 * Telegram keeps the button in a loading state for a few seconds until this is
 * called, so it runs before any slow work — never after.
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  });
}

export interface SentPhoto {
  messageId: number;
  /**
   * Telegram's own handle for the uploaded image. Every send after the first
   * passes this instead of the bytes: a poster is ~800KB, so re-uploading it
   * per subscriber was the bulk of the delivery time and the main reason a
   * batch ran into the function's timeout.
   */
  fileId: string | null;
}

/** Largest rendition Telegram kept, which is the one worth reusing. */
function largestFileId(photos: { file_id: string; width: number }[] | undefined): string | null {
  if (!photos?.length) return null;
  return photos.reduce((a, b) => (b.width > a.width ? b : a)).file_id;
}

export async function sendTelegramPhoto(
  chatId: number,
  photo: Buffer | string,
  caption: string,
): Promise<SentPhoto> {
  const common = { caption, parse_mode: "MarkdownV2" };
  let result: { message_id: number; photo?: { file_id: string; width: number }[] };

  if (typeof photo === "string") {
    result = await callTelegram("sendPhoto", { chat_id: chatId, photo, ...common });
  } else {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", caption);
    form.append("parse_mode", "MarkdownV2");
    form.append("photo", new Blob([new Uint8Array(photo)], { type: "image/png" }), "post.png");
    result = await callTelegram("sendPhoto", form);
  }

  return { messageId: result.message_id, fileId: largestFileId(result.photo) };
}
