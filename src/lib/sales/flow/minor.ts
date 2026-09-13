/**
 * VOYAGA YETMAGANLAR (16-band).
 *
 * Xizmatdan maktab o'quvchilari ham foydalanadi. Ularga nisbatan
 * sotuv bosimi — shoshirish, "faqat bugun", hissiy bosim — nafaqat
 * noto'g'ri, balki zararli. Bundan tashqari to'lov qarorini bola
 * mustaqil qabul qilmaydi.
 *
 * QAT'IY QOIDA: hech qachon ota-onadan yashirishga undamaslik.
 *
 * SOF MODUL.
 */

import { normalizeForIntent } from "../text-normalize.ts";

/**
 * Yosh haqidagi belgilar.
 *
 * TAXMIN EHTIYOTKOR TOMONGA: shubha bo'lsa "voyaga yetmagan" deb
 * hisoblanadi. Noto'g'ri "kattalar" deb hisoblash bolaga bosim
 * o'tkazish degani; teskarisi esa faqat ohangni yumshatadi.
 */
const MINOR_PATTERNS: readonly { pattern: RegExp; signal: string }[] = [
  { pattern: /\b(\d{1,2})\s*(yosh|yoshdaman|yoshman)\b/u, signal: "yoshini aytdi" },
  { pattern: /\b(maktab|maktabda|o'quvchi|oquvchi|o'quvchiman)\b/u, signal: "maktab o‘quvchisi" },
  // Qo'shimchali shakllar ham: "9-sinfda", "9-sinfman". Oxirgi `\b`
  // bo'lganda "sinfda" mos kelmay, o'quvchi kattalar qatoriga tushardi.
  { pattern: /\b(\d{1,2})\s*-?\s*sinf/u, signal: "sinf raqamini aytdi" },
  { pattern: /\b(litsey|kollej)\s*(o'quvchisi|oquvchisi|talabasi)?\b/u, signal: "litsey/kollej" },
];

export interface MinorDetection {
  isMinor: boolean;
  signal: string | null;
}

export function detectMinor(text: string | null | undefined): MinorDetection {
  const normalized = normalizeForIntent(text ?? "").trim();
  if (normalized === "") return { isMinor: false, signal: null };

  for (const { pattern, signal } of MINOR_PATTERNS) {
    const match = normalized.match(pattern);
    if (!match) continue;

    // Yosh raqami bo'lsa — aniq tekshiramiz.
    const age = Number(match[1]);
    if (Number.isFinite(age) && age >= 1 && age <= 99) {
      if (signal === "sinf raqamini aytdi") {
        // 11-sinf va pastrog'i — deyarli har doim 18 dan kichik.
        return age <= 11 ? { isMinor: true, signal: `${age}-sinf` } : { isMinor: false, signal: null };
      }
      return age < 18 ? { isMinor: true, signal: `${age} yosh` } : { isMinor: false, signal: null };
    }
    return { isMinor: true, signal };
  }
  return { isMinor: false, signal: null };
}

/**
 * Voyaga yetmagan mijoz uchun javobga qo'shiladigan ko'rsatma.
 *
 * Bu MODEL UCHUN ko'rsatma, mijozga yuboriladigan matn emas.
 */
export const MINOR_GUIDANCE = [
  "MIJOZ 18 DAN KICHIK BO‘LISHI MUMKIN.",
  "- Shoshirma, muddat bilan bosim o‘tkazma, hissiy bosim ishlatma.",
  "- To‘lov masalasida ota-ona yoki vasiy ishtirokini tabiiy tarzda eslat.",
  "- Ota-onadan yashirishga HECH QACHON undama.",
  "- Ohang do‘stona va tushuntiruvchi bo‘lsin; ma’lumot to‘liq berilaveradi.",
].join("\n");
