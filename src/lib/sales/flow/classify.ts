/**
 * Mijoz javobini NIYATGA ajratish.
 *
 * Yozishma o'zbekcha, lotin va kirill aralash, imlo erkin: "ha", "xa",
 * "хуш", "юк", "yoq" — hammasi bir xil ma'noni beradi. Shuning uchun
 * matn avval `normalizeForIntent` dan o'tadi (apostrof + variantlar) va
 * FAQAT shundan keyin taqqoslanadi. Xom xabar bazada o'zgarmaydi.
 *
 * TARTIB MUHIM: "tanishmadim" ichida "tanishdim" bor, "yo'q" esa
 * "ma'lumot bering" bilan bir ma'noda kelishi mumkin. Shuning uchun
 * inkor shakllari tasdiqdan OLDIN tekshiriladi.
 *
 * SOF MODUL — testda to'liq qoplanadi.
 */

import { normalizeForIntent } from "../text-normalize.ts";
import type { ReplyIntent } from "./stages.ts";

interface Rule {
  intent: ReplyIntent;
  /** Butun so'z sifatida qidiriladigan iboralar. */
  phrases: readonly string[];
}

/**
 * Qoidalar YUQORIDAN PASTGA ko'riladi — birinchi moslik yutadi.
 * Inkor shakllari tasdiqdan oldin turadi.
 */
const RULES: readonly Rule[] = [
  {
    intent: "not_reviewed",
    phrases: [
      "tanishmadim",
      "tanishib chiqmadim",
      "hali ko'rmadim",
      "ko'rmadim",
      "korma dim",
      "o'qimadim",
      "oqimadim",
      "hali o'qimadim",
      "ulgurmadim",
    ],
  },
  {
    intent: "reviewed",
    phrases: [
      "tanishdim",
      "tanishib chiqdim",
      "ko'rdim",
      "kordim",
      "o'qidim",
      "oqidim",
      "o'qib chiqdim",
    ],
  },
  {
    intent: "later",
    phrases: [
      "keyinroq",
      "keyin yozaman",
      "keyin qilaman",
      "keyin aytaman",
      "bir ozdan keyin",
      "birozdan keyin",
      "o'ylab ko'raman",
      "oylab koraman",
      "o'ylashim kerak",
      "maslahatlashaman",
      "maslahat qilaman",
      "ertaga",
    ],
  },
  {
    intent: "need_info",
    phrases: [
      "ma'lumot bering",
      "malumot bering",
      "tushuntirib bering",
      "tushuntiring",
      "batafsil",
      "bilmayman",
      "bilmiman",
      "xabarim yo'q",
    ],
  },
  {
    intent: "no",
    phrases: [
      "yo'q",
      "kerak emas",
      "kerakmas",
      "istamayman",
      "xohlamayman",
      "qiziqmayman",
      "rad etaman",
    ],
  },
  {
    intent: "yes",
    phrases: [
      "ha",
      "xo'p",
      "shunaqa",
      "shundoq",
      "to'g'ri",
      "togri",
      "albatta",
      "roziman",
      "rozi",
      "ok",
      "mayli",
      "bo'ladi",
      "boladi",
      "qildim",
      "qoldirganman",
      "qoldirdim",
    ],
  },
];

const QUESTION_MARKERS =
  /\b(qancha|qanday|qayer|qachon|nima|nega|kim|necha|nech|qaysi|bormi|mumkinmi|kerakmi|qanaqa)\b/;

export interface ClassifiedReply {
  intent: ReplyIntent;
  /** Qaysi ibora ishladi — diagnostikada ko'rsatiladi. */
  matched: string | null;
  normalized: string;
}

/** So'z chegarasi bilan qidiradi: "haq" ichidagi "ha" tasdiq emas. */
function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, "u").test(haystack);
}

export function classifyReply(text: string | null | undefined): ClassifiedReply {
  const normalized = normalizeForIntent(text ?? "").trim();
  if (normalized === "") return { intent: "other", matched: null, normalized };

  for (const rule of RULES) {
    for (const phrase of rule.phrases) {
      if (containsPhrase(normalized, phrase)) {
        return { intent: rule.intent, matched: phrase, normalized };
      }
    }
  }

  // Savol belgisi yoki so'roq so'zi — bilim bilan javob beriladigan holat.
  if (normalized.includes("?") || QUESTION_MARKERS.test(normalized)) {
    return { intent: "question", matched: null, normalized };
  }

  return { intent: "other", matched: null, normalized };
}

/* ---------------------------- media / chek ------------------------------ */

/** Rasm, skrinshot yoki PDF — to'lov isboti bo'lishi mumkin. */
export const PAYMENT_EVIDENCE_TYPES: readonly string[] = ["photo", "document", "image"];

export function isPaymentEvidenceType(messageType: string): boolean {
  return PAYMENT_EVIDENCE_TYPES.includes(messageType);
}
