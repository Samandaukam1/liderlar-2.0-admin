import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Koordinator botining Telegram transporti.
 *
 * ALOHIDA TOKEN VA ALOHIDA SEKRET. Post boti va AI sotuv botining
 * sozlamalari bu yerga umuman ko'rinmaydi: bittasining tokeni
 * sizib ketsa, qolgan ikkitasi ta'sirlanmaydi.
 *
 * TOKEN FAQAT SHU FAYLDA O'QILADI va hech qachon log'ga, javobga
 * yoki xato matniga tushmaydi.
 */

const TELEGRAM_API = "https://api.telegram.org";

export function isCoordinatorBotConfigured(): boolean {
  return Boolean(process.env.COORDINATOR_TELEGRAM_BOT_TOKEN?.trim());
}

export function isCoordinatorWebhookConfigured(): boolean {
  return Boolean(process.env.COORDINATOR_TELEGRAM_WEBHOOK_SECRET?.trim());
}

function botToken(): string {
  const token = process.env.COORDINATOR_TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("COORDINATOR_TELEGRAM_BOT_TOKEN sozlanmagan.");
  return token;
}

/**
 * Sekretni doimiy vaqtda solishtiradi.
 *
 * Oddiy `===` birinchi farqda to'xtaydi va javob vaqti bo'yicha
 * sekretni belgima-belgi topish nazariy jihatdan mumkin bo'lardi.
 */
export function isValidCoordinatorSecret(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface CoordInlineButton {
  text: string;
  callback_data: string;
}

export interface CoordSendResult {
  ok: boolean;
  messageId: number | null;
  error: string | null;
}

async function call(
  method: string,
  body: Record<string, unknown>,
): Promise<CoordSendResult> {
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${botToken()}/${method}`, {
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
      return { ok: false, messageId: null, error: parsed.description ?? `HTTP ${response.status}` };
    }
    return { ok: true, messageId: parsed.result?.message_id ?? null, error: null };
  } catch (err) {
    // Xato matnida token BO'LMASLIGI kerak — u URL ichida edi.
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, messageId: null, error: message.replace(/bot\d+:[\w-]+/g, "bot***") };
  }
}

export async function sendCoordinatorMessage(
  chatId: number,
  text: string,
  options: { replyKeyboard?: string[][]; inlineKeyboard?: CoordInlineButton[][] } = {},
): Promise<CoordSendResult> {
  const replyMarkup = options.inlineKeyboard
    ? { inline_keyboard: options.inlineKeyboard }
    : options.replyKeyboard
      ? {
          keyboard: options.replyKeyboard.map((row) => row.map((t) => ({ text: t }))),
          resize_keyboard: true,
          is_persistent: true,
        }
      : undefined;

  return call("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function editCoordinatorMessage(
  chatId: number,
  messageId: number,
  text: string,
): Promise<CoordSendResult> {
  return call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: { inline_keyboard: [] },
  });
}

export async function answerCoordinatorCallback(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await call("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  });
}

export const COORDINATOR_ALLOWED_UPDATES = ["message", "callback_query"] as const;

export async function setCoordinatorWebhook(url: string): Promise<CoordSendResult> {
  const secret = process.env.COORDINATOR_TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("COORDINATOR_TELEGRAM_WEBHOOK_SECRET sozlanmagan.");
  return call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: COORDINATOR_ALLOWED_UPDATES,
    // Kutib turgan xabarlar O'CHIRILMAYDI.
    drop_pending_updates: false,
  });
}

/** Sozlamalar sahifasi uchun: bot kim va webhook qayerda. Token CHIQMAYDI. */
export async function getCoordinatorBotStatus(): Promise<{
  username: string | null;
  webhookUrl: string | null;
  pendingUpdates: number | null;
  lastError: string | null;
} | null> {
  if (!isCoordinatorBotConfigured()) return null;
  try {
    const [meRes, hookRes] = await Promise.all([
      fetch(`${TELEGRAM_API}/bot${botToken()}/getMe`),
      fetch(`${TELEGRAM_API}/bot${botToken()}/getWebhookInfo`),
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
  } catch {
    return null;
  }
}
