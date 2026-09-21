/**
 * BO'SHLIQ KALITI — MA'NOGA KO'RA BIRLASHTIRISH (29-band).
 *
 * MUAMMO: kalit xom matnning normallashtirilgan shakli edi.
 * Shuning uchun "narxi qancha?", "qancha turadi?", "necha pul?",
 * "tolovi qancha" — TO'RTTA alohida bo'shliq bo'lib yozilardi.
 * Admin bir savolga to'rt marta javob yozishi kerak bo'lardi.
 *
 * CHEGARA BOR: qisqa savollar kontekstga qarab har xil ma'no
 * beradi ("Qancha?"). Shuning uchun birlashtirish FAQAT ma'nosi
 * aniq bir xil bo'lgan turlarda bajariladi — narx savoli kabi.
 * Qolganlari matn bo'yicha, lekin tozalangan shaklda.
 *
 * SOF MODUL.
 */

import { normalizeForIntent } from "../text-normalize.ts";
import type { MessageIntent } from "../flow/message-intent.ts";

/**
 * Ma'nosi bir xil deb hisoblanadigan niyatlar.
 *
 * RO'YXAT QISQA VA ATAYLAB. Har niyatni birlashtirish
 * ("jarayon savoli" ning hammasi bitta bo'shliq) turli
 * savollarni bir qatorga tiqib, javobni ma'nosiz qilardi.
 */
const CANONICAL_INTENTS: readonly MessageIntent[] = ["price_question"];

/** Ma'noga ta'sir qilmaydigan so'zlar — kalitdan chiqariladi. */
const STOPWORDS = new Set([
  "menga", "bizga", "sizga", "iltimos", "ayting", "aytingchi",
  "bilsam", "bo'ladi", "boladi", "mumkinmi", "mumkin", "ekan",
  "esa", "ham", "va", "yoki", "uchun", "haqida", "bo'yicha",
  "boyicha", "aka", "opa", "salom", "assalomu", "alaykum",
]);

/**
 * Bo'shliqni birlashtirish uchun kalit.
 *
 * Bir xil kalit — bir qator, `ask_count` oshadi.
 */
export function buildGapKey(question: string, intent: MessageIntent): string {
  if (CANONICAL_INTENTS.includes(intent)) return `intent:${intent}`;

  const words = normalizeForIntent(question)
    // Tinish belgilari kalitga ta'sir qilmasin: "narxi qancha?"
    // va "narxi qancha" bitta savol.
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word !== "" && !STOPWORDS.has(word));

  /*
   * SO'ZLAR TARTIBLANADI.
   *
   * "maqola narxi qancha" va "qancha maqola narxi" — bitta
   * savol. Tartibni saqlash ularni ikkiga bo'lib yuborardi.
   */
  const key = [...new Set(words)].sort().join(" ");
  return key === "" ? normalizeForIntent(question).trim().slice(0, 500) : key.slice(0, 500);
}
