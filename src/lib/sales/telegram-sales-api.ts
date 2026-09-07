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
 *   qoldiradi. Oq ro'yxat esa teskari ishlaydi — ruxsat etilgan
 *   metoddan tashqari HAMMASI xato tashlaydi.
 *
 * 0.2 DA NIMA O'ZGARDI: mijozga javob yozish kerak bo'ldi. Lekin
 * `ALLOWED_SALES_BOT_METHODS` ro'yxatiga `sendMessage` QO'SHILMADI —
 * u hamon xato tashlaydi. Yuborish butunlay ALOHIDA yo'ldan boradi:
 * `sendSalesMessage`, va u oddiy parametr emas, `outbound-guard.ts`
 * dagi MUHRLANGAN ruxsatni talab qiladi. Muhrni faqat o'sha modul
 * yasay oladi, ya'ni har yuborish uning tekshiruvlaridan o'tgan
 * bo'ladi: sozlama yoqiqmi, inson qo'lga olmaganmi, bosqich mosmi,
 * ulanish javob yozishga ruxsat berganmi.
 *
 * Natijada "tasodifiy `sendMessage` yordamchisi" degan narsa mavjud
 * emas: uni chaqirish uchun avval ruxsat olish shart.
 */

import { isOutboundAuthorized } from "./flow/outbound-guard.ts";

const TELEGRAM_API = "https://api.telegram.org";

/**
 * Ruxsat etilgan O'QISH metodlari. Birortasi ham mijozga xabar
 * yubormaydi: uchtasi webhook sozlash, bittasi bot haqida ma'lumot,
 * bittasi fayl havolasini olish.
 */
export const ALLOWED_SALES_BOT_METHODS = [
  "getMe",
  "getWebhookInfo",
  "setWebhook",
  "deleteWebhook",
  // 0.2: to'lov chekini yuklab olish uchun. O'QISH metodi — u orqali
  // mijozga hech narsa yuborib bo'lmaydi.
  "getFile",
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


/* ======================================================================== *
 * MIJOZGA JAVOB — MUHRLANGAN YO'L
 * ======================================================================== */

export interface SalesSendResult {
  ok: boolean;
  telegramMessageId: number | null;
  error: string | null;
}

/**
 * Business chatga xabar yuboradi.
 *
 * BIRINCHI QATOR — muhr tekshiruvi. Ruxsatsiz chaqiruv shu yerda
 * to'xtaydi va `SalesAutoReplyBlockedError` tashlaydi, ya'ni bu
 * funksiyani "shunchaki chaqirib" mijozga yozib bo'lmaydi.
 *
 * Sinov (simulated) ruxsati bilan chaqirilsa TARMOQQA UMUMAN
 * chiqmaydi — natija qaytadi, lekin Telegram bu haqda bilmaydi.
 */
export async function sendSalesMessage(
  authorization: unknown,
  text: string,
): Promise<SalesSendResult> {
  if (!isOutboundAuthorized(authorization)) {
    throw new SalesAutoReplyBlockedError("sendMessage (ruxsatsiz)");
  }

  if (authorization.simulated) {
    return { ok: true, telegramMessageId: null, error: null };
  }

  const response = await fetch(`${TELEGRAM_API}/bot${salesBotToken()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // Business chatga yozish uchun ulanish identifikatori majburiy.
      business_connection_id: authorization.businessConnectionId,
      chat_id: authorization.chatId,
      text,
      disable_web_page_preview: false,
    }),
  });

  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    };
    if (!parsed.ok) {
      return { ok: false, telegramMessageId: null, error: parsed.description ?? "Telegram rad etdi" };
    }
    return { ok: true, telegramMessageId: parsed.result?.message_id ?? null, error: null };
  } catch {
    return {
      ok: false,
      telegramMessageId: null,
      error: `Telegram javobi JSON emas (HTTP ${response.status})`,
    };
  }
}


/** Telegram fayli uchun yuklab olish havolasi. */
export async function getSalesFileUrl(fileId: string): Promise<string | null> {
  const res = await callSalesTelegram<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!res.ok || !res.result?.file_path) return null;
  return `${TELEGRAM_API}/file/bot${salesBotToken()}/${res.result.file_path}`;
}
