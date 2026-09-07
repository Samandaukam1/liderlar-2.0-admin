import { timingSafeEqual } from "node:crypto";

/**
 * Sotuv webhook'ining sekret tekshiruvi.
 *
 * Alohida modulda, chunki bu route'dagi YAGONA autentifikatsiya to'sig'i:
 * `/api/telegram-sales/*` admin sessiya middleware'idan chetlab o'tadi
 * (Telegram'da cookie yo'q va u redirect'ga ergasha olmaydi). Shuning
 * uchun bu funksiya testda to'g'ridan-to'g'ri tekshiriladi.
 *
 * Solishtirish DOIMIY VAQTLI: oddiy `===` javob berish vaqti orqali
 * sekretni bayt-bayt tanlab olishga imkon berardi.
 */
export function isValidWebhookSecret(
  expected: string | undefined | null,
  provided: string | null | undefined,
): boolean {
  // Sekret sozlanmagan bo'lsa hech kim kira olmaydi — "sozlanmagan" holat
  // "hamma uchun ochiq" degani emas.
  if (!expected) return false;
  if (!provided) return false;

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  // Uzunlik farqi ochiq solishtiriladi: timingSafeEqual turli uzunlikda
  // xato tashlaydi, uzunlikning o'zi esa sir emas.
  return a.length === b.length && timingSafeEqual(a, b);
}
