/**
 * TELEGRAM BOT API'GA SO'ROV — TARMOQ UZILISHIDA QAYTA URINISH.
 *
 * NEGA KERAK: 2026-10-09 dan production loglarida post botiga
 * kelgan updatelarning ~13% i `TypeError: fetch failed` bilan
 * tugadi. Supabase'ga yozish o'tgan, Telegram'ga javob esa
 * yuborilmagan — foydalanuvchi uchun bu "bot javob bermadi".
 *
 * `fetch failed` — HTTP javob UMUMAN kelmagan holat: ulanish
 * uzildi, vaqt tugadi yoki DNS javob bermadi. Transportlardagi
 * 429/5xx siyosati unga tegmasdi, chunki u javob status'iga
 * qaraydi, bu yerda esa status yo'q. Shuning uchun bitta
 * uzilish — bitta jim qolgan javob edi.
 *
 * FAQAT TARMOQ XATOSI qayta uriniladi. HTTP javob kelgan bo'lsa
 * (hatto 500), u chaqiruvchiga o'zgarishsiz qaytadi: 429/5xx ni
 * qanday hal qilish har transportning o'z ishi.
 *
 * TAKROR XABAR XAVFI ATAYLAB QABUL QILINGAN: ulanish so'rov
 * yetib borgandan KEYIN uzilsa, qayta urinish xabarni ikki marta
 * yuborishi mumkin. Kamdan-kam takror jim qolgan botdan yaxshi.
 *
 * Modul `@/` importsiz — `node --test` uni to'g'ridan-to'g'ri
 * yuklay olishi uchun.
 */

/** Jami urinishlar soni (birinchisi + ikki qayta urinish). */
export const TELEGRAM_NETWORK_ATTEMPTS = 3;

/** Urinishlar orasidagi kutish. Jami ~1,2 s — webhook javobini cho'zmaydi. */
const BACKOFF_MS = [300, 900] as const;

/** URL'dagi bot tokeni xato matniga tushib qolsa ham log'ga chiqmasin. */
function scrubToken(message: string): string {
  return message.replace(/bot\d+:[\w-]+/g, "bot***");
}

/**
 * `fetch failed` ning haqiqiy sababi `cause` ichida turadi
 * (masalan `ETIMEDOUT`, `ECONNRESET`, `UND_ERR_CONNECT_TIMEOUT`).
 * Avval log'ga faqat "fetch failed" chiqardi va sababni bilib
 * bo'lmasdi — endi u xato matniga qo'shiladi.
 */
export function describeNetworkError(err: unknown): { code: string | null; detail: string } {
  if (!(err instanceof Error)) return { code: null, detail: scrubToken(String(err)) };

  const cause = (err as { cause?: unknown }).cause as
    | { code?: unknown; message?: unknown; errors?: Array<{ code?: unknown }> }
    | undefined;

  const rawCode = cause?.code ?? cause?.errors?.find((e) => typeof e?.code === "string")?.code;
  const code = typeof rawCode === "string" ? rawCode : null;
  const causeMessage = typeof cause?.message === "string" && cause.message ? cause.message : null;

  const parts = [err.message];
  if (causeMessage && causeMessage !== err.message) parts.push(causeMessage);
  else if (code) parts.push(code);

  return { code, detail: scrubToken(parts.join(": ")) };
}

/** Barcha urinishlar tarmoq xatosi bilan tugadi. */
export class TelegramNetworkError extends Error {
  /** Plain field, not a parameter property — see PortraitProcessingError. */
  readonly code: string | null;
  readonly attempts: number;

  constructor(detail: string, code: string | null, attempts: number) {
    super(`${detail} (${attempts} urinish)`);
    this.name = "TelegramNetworkError";
    this.code = code;
    this.attempts = attempts;
  }
}

export interface FetchTelegramDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` bilan bir xil, faqat tarmoq xatosida qayta urinadi.
 *
 * Body `string` yoki `FormData` bo'lishi kerak — ikkovi ham har
 * urinishda qayta o'qiladi. Oqim (stream) body bir marta o'qiladi
 * va qayta yuborib bo'lmaydi, shuning uchun bu yerga berilmaydi.
 */
export async function fetchTelegram(
  url: string,
  init: RequestInit,
  deps: FetchTelegramDeps = {},
): Promise<Response> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;

  let last: { code: string | null; detail: string } = { code: null, detail: "fetch failed" };

  for (let attempt = 1; attempt <= TELEGRAM_NETWORK_ATTEMPTS; attempt += 1) {
    try {
      return await doFetch(url, init);
    } catch (err) {
      // Chaqiruvchi o'zi bekor qilgan so'rov — qayta urinilmaydi.
      if (init.signal?.aborted) throw err;

      last = describeNetworkError(err);
      if (attempt === TELEGRAM_NETWORK_ATTEMPTS) break;
      await sleep(BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]);
    }
  }

  throw new TelegramNetworkError(last.detail, last.code, TELEGRAM_NETWORK_ATTEMPTS);
}
