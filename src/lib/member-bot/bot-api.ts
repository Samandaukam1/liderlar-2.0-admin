import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { InlineButton } from "./messages.ts";

/**
 * A'zo botining Telegram transporti — TO'RTINCHI BOT.
 *
 * Post boti, AI sotuv boti va koordinator botidan BUTUNLAY
 * ajratilgan: o'z tokeni, o'z sekreti, o'z endpointi, o'z
 * jadvallari. Bittasining tokeni sizsa, qolganlari
 * ta'sirlanmaydi.
 *
 * TOKEN FAQAT SHU FAYLDA O'QILADI va hech qachon log'ga,
 * javobga yoki xato matniga tushmaydi.
 */

const TELEGRAM_API = "https://api.telegram.org";

/** Telegram bitta xabar uchun chegarasi. */
const TEXT_LIMIT = 4096;

export function isMemberBotConfigured(): boolean {
  return Boolean(process.env.MEMBER_TELEGRAM_BOT_TOKEN?.trim());
}

export function isMemberWebhookConfigured(): boolean {
  return Boolean(process.env.MEMBER_TELEGRAM_WEBHOOK_SECRET?.trim());
}

/**
 * Bot tokeni. Chaqiruvchi uni saqlamaydi va uzatmaydi —
 * faqat shu fayl ichidagi funksiyalar ishlatadi.
 */
export function memberBotToken(): string {
  const token = process.env.MEMBER_TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("MEMBER_TELEGRAM_BOT_TOKEN sozlanmagan.");
  return token;
}

/**
 * Sekretni doimiy vaqtda solishtiradi.
 *
 * Oddiy `===` birinchi farqda to'xtaydi va javob vaqti bo'yicha
 * sekretni belgima-belgi topish nazariy jihatdan mumkin bo'lardi.
 */
export function isValidMemberSecret(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface MemberSendResult {
  ok: boolean;
  messageId: number | null;
  error: string | null;
}

/** Xato matnidan token izini tozalaydi — u log'ga tushmasin. */
function scrub(message: string): string {
  const token = process.env.MEMBER_TELEGRAM_BOT_TOKEN?.trim();
  return token ? message.split(token).join("[token]") : message;
}

async function call(method: string, body: Record<string, unknown>): Promise<MemberSendResult> {
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${memberBotToken()}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const parsed = (await response.json()) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    };

    if (!parsed.ok) {
      return { ok: false, messageId: null, error: scrub(parsed.description ?? "noma'lum xato") };
    }
    return { ok: true, messageId: parsed.result?.message_id ?? null, error: null };
  } catch (err) {
    return {
      ok: false,
      messageId: null,
      error: scrub(err instanceof Error ? err.message : String(err)),
    };
  }
}

function keyboard(buttons: InlineButton[][]): Record<string, unknown> | undefined {
  return buttons.length > 0 ? { inline_keyboard: buttons } : undefined;
}

/** Xabarni chegaraga sig'diradi — kesilgani ochiq aytiladi. */
function fit(text: string): string {
  if (text.length <= TEXT_LIMIT) return text;
  const notice = "\n\n…(ro'yxat uzun — to'liq ko'rish uchun kabinetga kiring)";
  return text.slice(0, TEXT_LIMIT - notice.length) + notice;
}

export async function sendMemberMessage(
  chatId: number,
  text: string,
  buttons: InlineButton[][] = [],
): Promise<MemberSendResult> {
  return call("sendMessage", {
    chat_id: chatId,
    text: fit(text),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: keyboard(buttons),
  });
}

export async function editMemberMessage(
  chatId: number,
  messageId: number,
  text: string,
  buttons: InlineButton[][] = [],
): Promise<MemberSendResult> {
  return call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: fit(text),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: keyboard(buttons),
  });
}

/**
 * Callback tugmasiga javob.
 *
 * Telegram buni 10 soniya ichida kutadi, aks holda tugma
 * "osilib qoladi". `editMessageText` dan farqli o'laroq bu
 * chaqiruv tezlik chegarasiga tushmaydi.
 */
export async function answerMemberCallback(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await call("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  });
}

export const MEMBER_ALLOWED_UPDATES = ["message", "callback_query"] as const;

/**
 * Webhook'ni Telegram'da ro'yxatdan o'tkazadi.
 *
 * `drop_pending_updates: false` — ATAYLAB. Kutib turgan
 * xabarlar o'chirilsa, webhook sozlangan paytda navbatda
 * turgan odamlarning xabarlari jimgina yo'qolardi va ular
 * "bot javob bermadi" deb qolardi.
 */
export async function setMemberWebhook(url: string): Promise<MemberSendResult> {
  const secret = process.env.MEMBER_TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      messageId: null,
      error: "MEMBER_TELEGRAM_WEBHOOK_SECRET sozlanmagan.",
    };
  }

  return call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: MEMBER_ALLOWED_UPDATES,
    drop_pending_updates: false,
  });
}

export interface MemberBotStatus {
  username: string | null;
  webhookUrl: string | null;
  pendingUpdates: number | null;
  lastError: string | null;
}

/**
 * Sozlamalar sahifasi uchun: bot kim va webhook qayerda.
 *
 * TOKEN CHIQMAYDI. Qaytadigan maydonlar ataylab sanalgan —
 * `getWebhookInfo` javobini butunligicha uzatsak, unda
 * kutilmagan maydonlar paydo bo'lishi mumkin.
 */
export async function getMemberBotStatus(): Promise<MemberBotStatus | null> {
  if (!isMemberBotConfigured()) return null;

  try {
    const [meRes, hookRes] = await Promise.all([
      fetch(`${TELEGRAM_API}/bot${memberBotToken()}/getMe`),
      fetch(`${TELEGRAM_API}/bot${memberBotToken()}/getWebhookInfo`),
    ]);

    const me = (await meRes.json()) as { ok?: boolean; result?: { username?: string } };
    const hook = (await hookRes.json()) as {
      ok?: boolean;
      result?: { url?: string; pending_update_count?: number; last_error_message?: string };
    };

    return {
      username: me.result?.username ?? null,
      webhookUrl: hook.result?.url ?? null,
      pendingUpdates: hook.result?.pending_update_count ?? null,
      lastError: hook.result?.last_error_message ?? null,
    };
  } catch (err) {
    console.error("MEMBER_BOT_STATUS_FAILED", scrub(err instanceof Error ? err.message : String(err)));
    return null;
  }
}
