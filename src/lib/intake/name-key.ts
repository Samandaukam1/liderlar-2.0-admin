/**
 * Ism bo'yicha ichki identifikator — sof modul.
 *
 * Bu yerda I/O yo'q, shuning uchun apostrof qoidalari haqiqiy unit testlar
 * bilan qoplanadi. Kalit hech qachon URL'ga tushmaydi — u faqat "bu o'sha
 * odammi?" degan savolga javob beradi.
 */

// Relative, not "@/": this module is exercised by the raw node:test runner,
// which resolves no tsconfig path aliases.
import { slugify } from "../utils.ts";

/**
 * Every apostrophe Uzbek names are written with.
 *
 * `oʻgʻli`, `oʼgʼli`, `o'g'li`, `o‘g‘li` and `ogli` are one person, but they
 * are five different code points: U+02BB and U+02BC (the correct modifier
 * letters), U+2018/U+2019 (what word processors insert), and the plain ASCII
 * quote.
 */
const APOSTROPHES = /[ʻʼ‘’'`´]/g;

/**
 * The identity used to recognise a person by name.
 *
 * Deliberately NOT `slugify` alone. slugify strips U+02BC, U+2019 and the
 * ASCII quote but keeps U+02BB, so `oʻgʻli` slugs to `o-g-li` while `o'g'li`
 * slugs to `ogli` — the same person, two keys, and a list that silently misses
 * whichever spelling it was not given. This collapses every variant first and
 * then reuses slugify for the rest: the Cyrillic mapping and diacritic
 * stripping it already does correctly.
 *
 * It is safe to be stricter here than slugify is. This key is internal and
 * never appears in a URL, so tightening it cannot move a published article.
 */
export function blacklistKey(fullName: string): string {
  return slugify(fullName.replace(APOSTROPHES, ""));
}
