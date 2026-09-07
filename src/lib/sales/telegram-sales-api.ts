import "server-only";

/**
 * Sotuv botining Telegram transporti — va 0.1 dagi "avto-javob yo'q"
 * talabining KOD DARAJASIDAGI kafolati.
 *
 * MAVJUD POST BOTIGA TEGILMAYDI. U `TELEGRAM_BOT_TOKEN` bilan ishlaydi va
 * o'z transporti (`post-studio/telegram-api.ts`) orqali yuboradi. Bu yerda
 * FAQAT `SALES_TELEGRAM_BOT_TOKEN` o'qiladi; ikki tizim bir-birining
 * tokenini ko'rmaydi.
 *
 * NEGA OQ RO'YXAT (allowlist), qora ro'yxat emas:
 *   Qora ro'yxat "sendMessage taqiqlangan" deydi va `copyMessage`,
 *   `sendPhoto`, `answerCallbackQuery` kabi o'nlab boshqa yo'lni ochiq
 *   qoldiradi. Oq ro'yxat esa teskari ishlaydi — 0.1 da ruxsat etilgan
 *   to'rtta metoddan tashqari HAMMASI xato tashlaydi. 0.2 da draft javob
 *   qo'shilganda ro'yxat ATAYLAB kengaytirilishi kerak bo'ladi, ya'ni
 *   avto-javob tasodifan paydo bo'lolmaydi.
 */

const TELEGRAM_API = "https://api.telegram.org";

/**
 * 0.1 da ruxsat etilgan metodlar. Birortasi ham mijozga xabar yubormaydi:
 * uchtasi webhook sozlash, bittasi bot haqida ma'lumot.
 */
export const ALLOWED_SALES_BOT_METHODS = [
  "getMe",
  "getWebhookInfo",
  "setWebhook",
  "deleteWebhook",
] as const;

export type AllowedSalesBotMethod = (typeof ALLOWED_SALES_BOT_METHODS)[number];

export class SalesAutoReplyBlockedError extends Error {
  readonly method: string;

  constructor(method: string) {
    super(
      `Sotuv boti 0.1 da "${method}" metodini chaqira olmaydi: bot mijozga ` +
        "avtomatik javob yozmaydi. Avto-javob 0.2 doirasida qo‘shiladi.",
    );
    this.name = "SalesAutoReplyBlockedError";
    this.method = method;
  }
}

/** Metod oq ro'yxatda bo'lmasa xato tashlaydi. Sof funksiya — testda tekshiriladi. */
export function assertAllowedSalesMethod(method: string): asserts method is AllowedSalesBotMethod {
  if (!(ALLOWED_SALES_BOT_METHODS as readonly string[]).includes(method)) {
    throw new SalesAutoReplyBlockedError(method);
  }
}

export function isSalesBotConfigured(): boolean {
  return Boolean(process.env.SALES_TELEGRAM_BOT_TOKEN);
}

export function isSalesWebhookConfigured(): boolean {
  return Boolean(process.env.SALES_TELEGRAM_WEBHOOK_SECRET);
}

/** Token faqat shu yerda o'qiladi va hech qachon log'ga yozilmaydi. */
function salesBotToken(): string {
  const token = process.env.SALES_TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("SALES_TELEGRAM_BOT_TOKEN sozlanmagan.");
  return token;
}

export interface SalesTelegramResult<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

/**
 * Bot API chaqiruvi. Har chaqiruv oq ro'yxatdan o'tadi — shuning uchun
 * bu funksiya orqali mijozga xabar yuborib bo'lmaydi.
 */
export async function callSalesTelegram<T>(
  method: string,
  body: Record<string, unknown> = {},
): Promise<SalesTelegramResult<T>> {
  assertAllowedSalesMethod(method);

  const response = await fetch(`${TELEGRAM_API}/bot${salesBotToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  try {
    return JSON.parse(raw) as SalesTelegramResult<T>;
  } catch {
    return { ok: false, description: `Telegram javobi JSON emas (HTTP ${response.status})` };
  }
}

export interface SalesBotInfo {
  id: number;
  username: string | null;
  firstName: string | null;
}

/** Sozlamalar sahifasi uchun: bot ulanganmi va kim u. */
export async function getSalesBotInfo(): Promise<SalesBotInfo | null> {
  if (!isSalesBotConfigured()) return null;
  try {
    const res = await callSalesTelegram<{
      id: number;
      username?: string;
      first_name?: string;
    }>("getMe");
    if (!res.ok || !res.result) return null;
    return {
      id: res.result.id,
      username: res.result.username ?? null,
      firstName: res.result.first_name ?? null,
    };
  } catch {
    return null;
  }
}

export interface SalesWebhookInfo {
  url: string | null;
  pendingUpdateCount: number;
  lastErrorMessage: string | null;
  lastErrorDate: string | null;
  allowedUpdates: string[];
}

export async function getSalesWebhookInfo(): Promise<SalesWebhookInfo | null> {
  if (!isSalesBotConfigured()) return null;
  try {
    const res = await callSalesTelegram<{
      url?: string;
      pending_update_count?: number;
      last_error_message?: string;
      last_error_date?: number;
      allowed_updates?: string[];
    }>("getWebhookInfo");
    if (!res.ok || !res.result) return null;
    return {
      url: res.result.url || null,
      pendingUpdateCount: res.result.pending_update_count ?? 0,
      lastErrorMessage: res.result.last_error_message ?? null,
      lastErrorDate: res.result.last_error_date
        ? new Date(res.result.last_error_date * 1000).toISOString()
        : null,
      allowedUpdates: res.result.allowed_updates ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * 0.1 da eshitiladigan update turlari. Ro'yxat qisqa: bot boshqa hech
 * narsani olmaydi, ya'ni oddiy `message` ga javob berish imkoniyati
 * Telegram tomonida ham yopiladi.
 */
export const SALES_ALLOWED_UPDATES = [
  "business_connection",
  "business_message",
  "edited_business_message",
  "deleted_business_messages",
] as const;

export async function setSalesWebhook(url: string): Promise<SalesTelegramResult<boolean>> {
  const secret = process.env.SALES_TELEGRAM_WEBHOOK_SECRET;
  if (!secret) throw new Error("SALES_TELEGRAM_WEBHOOK_SECRET sozlanmagan.");
  return callSalesTelegram<boolean>("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: SALES_ALLOWED_UPDATES,
    drop_pending_updates: false,
  });
}
