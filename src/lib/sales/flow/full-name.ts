/**
 * To'liq F.I.Sh. tekshiruvi.
 *
 * MUAMMO: "Maryam" — ism, lekin F.I.Sh. emas. Anketa shu nom bilan
 * yaratilsa, maqola ham, sertifikat ham chala nom bilan chiqadi va
 * keyin qo'lda tuzatiladi. Shuning uchun kamida IKKI ma'noli bo'lak
 * talab qilinadi.
 *
 * SOF MODUL.
 */

import { normalizeApostrophes } from "../text-normalize.ts";

/** Ismning bo'lagi bo'la olmaydigan so'zlar — mijoz ko'pincha shunday yozadi. */
const NOISE_WORDS = new Set([
  "ismim", "mening", "men", "familiyam", "fish", "f.i.sh", "ism", "familiya",
  "bu", "ha", "salom", "assalomu", "alaykum", "rahmat", "yaxshi",
]);

export interface FullNameCheck {
  ok: boolean;
  /** Tozalangan, saqlashga tayyor shakl. */
  fullName: string;
  tokens: string[];
  /**
   * Otasining ismidan chiqarilgan jins. Aniqlanmasa `null` —
   * TAXMIN QILINMAYDI, admin anketada to'ldiradi.
   */
  gender: "male" | "female" | null;
  reason?: string;
}

/** Kamida shuncha ma'noli bo'lak bo'lishi shart. */
export const MIN_NAME_TOKENS = 2;

/**
 * Otasining ismi qo'shimchasi jinsni deyarli xatosiz beradi:
 * -ovna/-evna/qizi -> ayol, -ovich/-evich/o'g'li -> erkak.
 * Boshqa holatda `null` qaytadi.
 */
export function inferGender(tokens: readonly string[]): "male" | "female" | null {
  const joined = tokens.join(" ").toLowerCase();
  if (/(ovna|evna|qizi|kizi)\b/.test(joined)) return "female";
  if (/(ovich|evich|o'g'li|ogli|oglu|ugli)\b/.test(joined)) return "male";
  return null;
}

export function validateFullName(input: string | null | undefined): FullNameCheck {
  const raw = normalizeApostrophes(input ?? "").trim();
  if (raw === "") {
    return { ok: false, fullName: "", tokens: [], gender: null, reason: "bo‘sh" };
  }

  const tokens = raw
    .split(/[\s,]+/)
    .map((token) => token.replace(/[^\p{L}'-]/gu, "").trim())
    .filter((token) => {
      if (token.length < 2) return false;
      return !NOISE_WORDS.has(token.toLowerCase());
    });

  if (tokens.length < MIN_NAME_TOKENS) {
    return {
      ok: false,
      fullName: tokens.join(" "),
      tokens,
      gender: null,
      reason: "kamida familiya va ism kerak",
    };
  }

  // Har bo'lak bosh harf bilan — saqlanadigan shakl bir xil bo'lsin.
  const fullName = tokens
    .map((token) => token.charAt(0).toLocaleUpperCase("uz") + token.slice(1))
    .join(" ")
    .slice(0, 200);

  return { ok: true, fullName, tokens, gender: inferGender(tokens) };
}
