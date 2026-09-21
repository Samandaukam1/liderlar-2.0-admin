/**
 * IMTIYOZLI YO'NALISH — tanish orqali kelgan nomzod.
 *
 * Ba'zi odamlar bizga tanish nomidan yozadi: "Diyorbek
 * Niyatullayevich nomidan yozayapman", "Shohruh Kamolovdanman",
 * "O'zak jamoasidanman". Bunday odamdan PUL SO'RALMAYDI va unga
 * pulga oid hech narsa yuborilmaydi — undan faqat ism so'raladi
 * va havola beriladi.
 *
 * NEGA ALOHIDA MODUL: bu qoidani ssenariy jadvaliga qo'shib
 * qo'yish yetarli emas edi. Narx va to'lov matni suhbatga UCH
 * yo'ldan chiqishi mumkin — ssenariy o'tishidan, bilim
 * bazasidagi javobdan va follow-up'dan. Shuning uchun taniqlash
 * bir joyda, taqiq esa yuborishning o'zida turadi.
 *
 * SOF MODUL — baza ham, Telegram ham yo'q.
 */

import { normalizeForIntent } from "../text-normalize.ts";

export interface ReferralSource {
  key: string;
  /** Panelda ko'rinadigan nom. */
  label: string;
  /**
   * Qidiriladigan iboralar — normallashtirilgan shaklda
   * (kichik harf, yagona apostrof).
   */
  phrases: readonly string[];
}

/**
 * IBORALAR TO'LIQ YOZILADI, ISM YOLG'IZ EMAS.
 *
 * "niyatullayevich" ni yolg'iz qidirish xato bo'lardi: bu
 * o'zbekcha OTASINING ISMI shakli va nomzodning o'zi
 * "Aziz Niyatullayevich" bo'lishi mumkin. Shunda begona odam
 * bepul maqolaga ega bo'lardi. Shu sababli ism va familiya
 * birga qidiriladi.
 *
 * "o'zak" ham yolg'iz qidirilmaydi — bu oddiy so'z ("o'zak
 * masala"). Faqat "jamoa" bilan birga.
 */
export const REFERRAL_SOURCES: readonly ReferralSource[] = [
  {
    key: "diyorbek_niyatullayevich",
    label: "Diyorbek Niyatullayevich",
    phrases: [
      // "niyatulla" prefiksi niyatullayev / niyatullaev /
      // niyatullayevich variantlarini ham qamrab oladi.
      "diyorbek niyatulla",
      "diyarbek niyatulla",
      "niyatullayev diyorbek",
      "niyatullaev diyorbek",
    ],
  },
  {
    key: "shohruh_kamolov",
    label: "Shohruh Kamolov",
    phrases: [
      // O'zbek yozuvida h/x va u/o' almashib ketadi.
      "shohruh kamolov",
      "shohrux kamolov",
      "shoxruh kamolov",
      "shoxrux kamolov",
      "kamolov shohruh",
      "kamolov shoxrux",
    ],
  },
  {
    key: "ozak_jamoasi",
    label: "O'zak jamoasi",
    phrases: [
      // Qo'shimcha kesilmaydi: "jamoa" prefiksi jamoasi /
      // jamoasidan / jamoasidanman ni ham tutadi.
      "o'zak jamoa",
      "ozak jamoa",
      "o'zak guruh",
      "ozak guruh",
      "o'zak loyiha",
      "ozak loyiha",
    ],
  },
];

export const REFERRAL_SOURCE_LABELS: Readonly<Record<string, string>> =
  Object.fromEntries(REFERRAL_SOURCES.map((source) => [source.key, source.label]));

export function isReferralSourceKey(value: unknown): value is string {
  return typeof value === "string" && value in REFERRAL_SOURCE_LABELS;
}

/**
 * Ibora matnda bormi.
 *
 * BOSHIDA chegara bor, OXIRIDA yo'q. O'zbek tili qo'shimchali:
 * "jamoasidanman" ni tutish uchun oxirgi chegara bo'lmasligi
 * kerak. Boshidagi chegara esa iboraning boshqa so'z ichida
 * tasodifan uchrashining oldini oladi.
 */
function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}`, "u").test(haystack);
}

export interface ReferralDetection {
  source: string;
  label: string;
  matched: string;
}

/** Matnda tanish nomi bormi. Topilmasa null. */
export function detectReferral(text: string | null | undefined): ReferralDetection | null {
  const normalized = ` ${normalizeForIntent(text ?? "").trim()}`;
  if (normalized.trim() === "") return null;

  for (const source of REFERRAL_SOURCES) {
    for (const phrase of source.phrases) {
      if (containsPhrase(normalized, phrase)) {
        return { source: source.key, label: source.label, matched: phrase };
      }
    }
  }
  return null;
}

/* ========================================================================= *
 * PULGA OID NARSALAR
 * ========================================================================= */

/**
 * Narx yoki to'lov so'raydigan shablonlar.
 *
 * `payment_received` ("chek qabul qilindi") bu ro'yxatda EMAS:
 * u pul so'ramaydi, kelgan chekni tasdiqlaydi. Uni bloklash
 * to'lagan odamni javobsiz qoldirardi.
 */
export const MONEY_TEMPLATE_KEYS: readonly string[] = [
  "price_offer",
  "price_offer_inbound",
  "payment_details",
  "payment_note",
];

export function isMoneyTemplate(key: string | null | undefined): boolean {
  return key != null && MONEY_TEMPLATE_KEYS.includes(key);
}

/**
 * Pulga oid so'zlar — BUTUN SO'Z sifatida.
 *
 * "bepul" ichida "pul" bor, lekin uning ma'nosi TESKARI: bu
 * xizmat tekin degani va uni bloklash foydalar matnini
 * yo'qotardi. Shuning uchun qism-satr emas, so'z chegarasi.
 */
const MONEY_WORDS: readonly string[] = [
  "pul",
  "pullar",
  "to'lov",
  "to'lang",
  "to'lash",
  "to'laysiz",
  "narx",
  "narxi",
  "badal",
  "chegirma",
  "karta",
  "kartaga",
  "uzcard",
  "humo",
  "hisob raqam",
  "so'm",
  "som",
];

/** Karta raqami va "38 ming", "100 000 so'm" kabi summalar. */
const MONEY_PATTERNS: readonly RegExp[] = [
  /\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/,
  /\d[\d\s.,]*\s*(?:ming|000)/u,
];

/**
 * Matnda pul gapi bormi.
 *
 * Bu tekshiruv MODEL YOZGAN javobga qo'llanadi: shablonlarni
 * kalit bo'yicha bloklash yetarli emas edi, chunki bilim
 * bazasidan kelgan javob ham narxni aytib qo'yishi mumkin.
 */
export function mentionsMoney(text: string | null | undefined): boolean {
  const normalized = normalizeForIntent(text ?? "");
  if (normalized.trim() === "") return false;

  for (const word of MONEY_WORDS) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, "u").test(normalized)) {
      return true;
    }
  }
  return MONEY_PATTERNS.some((pattern) => pattern.test(normalized));
}
