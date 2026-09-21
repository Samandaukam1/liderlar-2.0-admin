/**
 * OPT-OUT (14-band) — mijoz "boshqa yozmang" desa.
 *
 * QOIDA: avtomatik aloqa TO'XTAYDI. Qayta ishontirishga urinish yo'q,
 * "sababini ayting" degan savol yo'q, "bir daqiqa vaqtingiz bo'lsa"
 * yo'q. Bunday odamni voronkaga qaytarishga urinish — ishonchni
 * yo'qotishning eng qisqa yo'li, va u bitta mijozdan ko'p narsaga
 * turadi.
 *
 * SOF MODUL.
 */

import { normalizeForIntent, normalizePhrase } from "../text-normalize.ts";

/**
 * ANIQ iboralar.
 *
 * Faqat SHUBHASIZ shakllar. "Kerak emas" bu yerda YO'Q — u ko'pincha
 * taklifning o'ziga ("maqola kerak emas"), aloqaga emas, tegishli
 * bo'ladi va uni opt-out deb o'qish suhbatni noo'rin tugatardi.
 */
const OPT_OUT_PHRASES: readonly string[] = [
  "yozmang",
  "yozmanglar",
  "boshqa yozmang",
  "boshqa yozmanglar",
  "bezovta qilmang",
  "bezovta qilmanglar",
  "bezovta qilmasangiz",
  "xabar yubormang",
  "xabar yozmang",
  "qayta yozmang",
  "meni tinch qo'ying",
  "tinch qo'ying",
  "spam",
  "unsubscribe",
  "otpisatsya",
  "не пишите",
  "отстаньте",
  "stop",
  "стоп",
];

export interface OptOutResult {
  optedOut: boolean;
  matched: string | null;
}

function contains(haystack: string, phrase: string): boolean {
  // Ibora ham matn bilan BIR XIL normalizatsiyadan o'tadi: kirill
  // ro'yxat lotin matn bilan uchrashmay qolmasligi kerak.
  const escaped = normalizePhrase(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, "u").test(haystack);
}

export function detectOptOut(text: string | null | undefined): OptOutResult {
  const normalized = normalizeForIntent(text ?? "").trim();
  if (normalized === "") return { optedOut: false, matched: null };

  for (const phrase of OPT_OUT_PHRASES) {
    if (contains(normalized, phrase)) return { optedOut: true, matched: phrase };
  }
  return { optedOut: false, matched: null };
}

/**
 * Opt-out'ga yagona javob.
 *
 * Bitta jumla: uzr, tasdiq, va eshik ochiq qolgani. Savol YO'Q —
 * savol javob kutadi, javob kutish esa aloqani davom ettirish degani.
 */
export const OPT_OUT_REPLY =
  "Tushundim, bezovta qilganim uchun uzr. Boshqa yozmayman. " +
  "Agar keyinchalik o‘zingiz xohlasangiz, shu yerga yozsangiz bo‘ldi.";
