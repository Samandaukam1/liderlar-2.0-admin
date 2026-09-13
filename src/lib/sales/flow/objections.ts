/**
 * E'TIROZ DVIGATELI (9-band).
 *
 * NEGA KERAK: "qimmat ekan" savol emas, e'tiroz. Ilgari u `other`
 * bo'lib tushardi va ssenariyda javobi yo'qligi uchun bilim bazasiga
 * borardi — u yerda esa "qimmat" degan savol yo'q. Natijada mijoz
 * e'tiroz bildirganda AI umuman javob bermasdi. Sotuv suhbatida eng
 * yomon javob — jim qolish.
 *
 * BITTA XABARDA BIR NECHTA E'TIROZ bo'lishi mumkin: "qimmat ekan,
 * ishonchlimi o'zi?" — PRICE + TRUST. Shuning uchun natija ro'yxat.
 *
 * SOF MODUL — hech qanday I/O yo'q.
 */

import { normalizeForIntent } from "../text-normalize.ts";

export const OBJECTION_KINDS = [
  "PRICE",
  "TRUST",
  "NEED_TO_THINK",
  "ASK_PARENTS",
  "ASK_FAMILY",
  "NO_MONEY_NOW",
  "PAY_LATER",
  "NOT_INTERESTED",
  "WHAT_IS_THE_BENEFIT",
  "IS_IT_OFFICIAL",
  "IS_IT_REAL",
  "HOW_FOUND_ME",
  "PRIVACY",
  "ARTICLE_QUALITY",
  "PHOTO_REQUIREMENT",
  "PAYMENT_SAFETY",
  "TIME",
  "CERTIFICATE",
  "GOOGLE_INDEXING",
  "WIKIPEDIA",
  "SOCIAL_VERIFICATION",
  "OTHER",
] as const;

export type ObjectionKind = (typeof OBJECTION_KINDS)[number];

export const OBJECTION_LABELS: Record<ObjectionKind, string> = {
  PRICE: "Narx qimmat",
  TRUST: "Ishonch yo‘q",
  NEED_TO_THINK: "O‘ylab ko‘rishi kerak",
  ASK_PARENTS: "Ota-onasidan so‘rashi kerak",
  ASK_FAMILY: "Oilasi bilan maslahatlashadi",
  NO_MONEY_NOW: "Hozir puli yo‘q",
  PAY_LATER: "Keyinroq to‘layman",
  NOT_INTERESTED: "Qiziqmayapti",
  WHAT_IS_THE_BENEFIT: "Foydasi nima",
  IS_IT_OFFICIAL: "Rasmiymi",
  IS_IT_REAL: "Haqiqiymi",
  HOW_FOUND_ME: "Meni qayerdan topdingiz",
  PRIVACY: "Shaxsiy ma’lumot xavfsizligi",
  ARTICLE_QUALITY: "Maqola sifati",
  PHOTO_REQUIREMENT: "Rasm talabi",
  PAYMENT_SAFETY: "To‘lov xavfsizligi",
  TIME: "Vaqt / muddat",
  CERTIFICATE: "Sertifikat",
  GOOGLE_INDEXING: "Google’da chiqishi",
  WIKIPEDIA: "Wikipedia",
  SOCIAL_VERIFICATION: "Ko‘k belgi / tasdiq",
  OTHER: "Boshqa e’tiroz",
};

interface ObjectionRule {
  kind: ObjectionKind;
  phrases: readonly string[];
}

/**
 * QOIDALAR TARTIBI MUHIM EMAS — hammasi ko'rib chiqiladi va topilgan
 * har biri qaytariladi. Bu niyat tasnifidan farqli: u yerda bitta
 * javob kerak, bu yerda esa mijoz aytgan HAMMA e'tiroz kerak.
 *
 * Iboralar `normalizeForIntent` dan o'tgan matnga solishtiriladi,
 * ya'ni apostrof variantlari va kirill shakllar allaqachon
 * bir xillashtirilgan.
 */
const RULES: readonly ObjectionRule[] = [
  {
    kind: "PRICE",
    phrases: [
      "qimmat", "qimat", "narxi baland", "juda ko'p pul", "arzonroq",
      "chegirma", "skidka", "дорого", "qimmatroq", "pulga qimmat",
    ],
  },
  {
    kind: "NO_MONEY_NOW",
    phrases: [
      "pulim yo'q", "pul yo'q", "hozir pulim", "mablag'im yo'q",
      "imkoniyatim yo'q", "puli yo'q", "hozircha pulim",
    ],
  },
  {
    kind: "PAY_LATER",
    phrases: [
      "keyin to'layman", "keyinroq to'layman", "oyoxirida", "oy oxirida",
      "maoshdan keyin", "stipendiya", "bo'lib to'lash", "bolib tolash",
      "keyin tolayman",
    ],
  },
  {
    kind: "TRUST",
    phrases: [
      "ishonchlimi", "ishonsam bo'ladimi", "aldamaysizmi", "aldov",
      "firibgar", "scam", "обман", "ishonmayman", "ishonch yo'q",
    ],
  },
  {
    kind: "IS_IT_OFFICIAL",
    phrases: ["rasmiymi", "rasmiy", "davlat", "litsenziya", "guvohnoma bormi"],
  },
  {
    kind: "IS_IT_REAL",
    phrases: ["haqiqiymi", "rostmi", "chinmi", "haqiqatdan", "rost gapmi"],
  },
  {
    kind: "NEED_TO_THINK",
    phrases: ["o'ylab ko'raman", "oylab koraman", "o'ylashim kerak", "bir o'ylay"],
  },
  {
    kind: "ASK_PARENTS",
    phrases: [
      "ota onam", "otamdan", "onamdan", "ota-onam", "dadamdan", "oyimdan",
      "ota onamdan so'rayman", "родител",
    ],
  },
  {
    kind: "ASK_FAMILY",
    phrases: ["oilam bilan", "turmush o'rtog'im", "akam bilan", "opam bilan", "maslahatlashaman"],
  },
  {
    kind: "NOT_INTERESTED",
    phrases: ["qiziqmayman", "kerak emas", "kerakmas", "xohlamayman", "istamayman", "не интересно"],
  },
  {
    kind: "WHAT_IS_THE_BENEFIT",
    phrases: ["foydasi nima", "nima foyda", "nima beradi", "menga nima", "foydasi bormi"],
  },
  {
    kind: "HOW_FOUND_ME",
    phrases: ["qayerdan topdingiz", "qayerdan bildingiz", "raqamimni qayerdan", "kim aytdi"],
  },
  {
    kind: "PRIVACY",
    phrases: [
      "ma'lumotlarim", "shaxsiy ma'lumot", "maxfiy", "kimga beriladi",
      "boshqalarga", "tarqalib ketmaydimi",
    ],
  },
  {
    kind: "ARTICLE_QUALITY",
    phrases: ["kim yozadi", "qanday yoziladi", "maqola qanaqa", "sifatli", "ko'rib chiqamanmi"],
  },
  {
    kind: "PHOTO_REQUIREMENT",
    phrases: ["rasm kerakmi", "surat", "foto", "rasmim yo'q", "qanaqa rasm"],
  },
  {
    kind: "PAYMENT_SAFETY",
    phrases: ["karta xavfsiz", "pulim yo'qolmaydi", "to'lov xavfsiz", "qaytarib berasizmi", "kafolat"],
  },
  {
    kind: "TIME",
    phrases: ["qancha vaqt", "qachon tayyor", "necha kun", "uzoq", "tez bo'ladimi", "qachon chiqadi"],
  },
  {
    kind: "CERTIFICATE",
    phrases: ["sertifikat", "guvohnoma", "diplom", "сертификат"],
  },
  {
    kind: "GOOGLE_INDEXING",
    phrases: ["google", "gugl", "qidiruvda", "internetda chiqadimi", "izlasam chiqadimi"],
  },
  {
    kind: "WIKIPEDIA",
    phrases: ["wikipedia", "vikipediya", "википедия", "vikipedia"],
  },
  {
    kind: "SOCIAL_VERIFICATION",
    phrases: ["ko'k belgi", "kok belgi", "galochka", "tasdiqlangan akkaunt", "verified", "sinigi"],
  },
];

export interface DetectedObjection {
  kind: ObjectionKind;
  /** Qaysi ibora ishladi — diagnostikada ko'rsatiladi. */
  matched: string;
}

/** So'z chegarasi bilan: "haq" ichidagi "ha" e'tiroz emas. */
function contains(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, "u").test(haystack);
}

/**
 * Xabardagi HAMMA e'tirozni topadi.
 *
 * Topilmasa BO'SH ro'yxat qaytadi — "OTHER" avtomatik qo'yilmaydi.
 * "Nomaʼlum eʼtiroz" deb belgilash chaqiruvchini javob yozishga
 * majburlardi, holbuki mijoz umuman eʼtiroz bildirmagan bo'lishi
 * mumkin.
 */
export function detectObjections(text: string | null | undefined): DetectedObjection[] {
  const normalized = normalizeForIntent(text ?? "").trim();
  if (normalized === "") return [];

  const found: DetectedObjection[] = [];
  for (const rule of RULES) {
    for (const phrase of rule.phrases) {
      if (contains(normalized, phrase)) {
        found.push({ kind: rule.kind, matched: phrase });
        break;
      }
    }
  }
  return found;
}

/**
 * Suhbatdagi e'tirozlar ro'yxatini yangilaydi.
 *
 * Eskisi SAQLANADI: mijoz narx haqida bir marta aytgan bo'lsa, keyin
 * boshqa mavzuga o'tsa ham o'sha e'tiroz suhbatning haqiqati bo'lib
 * qoladi va yakuniy javobda hisobga olinishi kerak.
 */
export function mergeObjections(
  existing: readonly string[],
  detected: readonly DetectedObjection[],
): ObjectionKind[] {
  const set = new Set<ObjectionKind>();
  for (const value of existing) {
    if ((OBJECTION_KINDS as readonly string[]).includes(value)) set.add(value as ObjectionKind);
  }
  for (const item of detected) set.add(item.kind);
  return [...set];
}

/** Eng muhim e'tiroz — javob shunga qaratiladi. */
const PRIORITY: readonly ObjectionKind[] = [
  "NOT_INTERESTED",
  "TRUST",
  "IS_IT_REAL",
  "PRIVACY",
  "PAYMENT_SAFETY",
  "PRICE",
  "NO_MONEY_NOW",
  "IS_IT_OFFICIAL",
  "WHAT_IS_THE_BENEFIT",
  "ASK_PARENTS",
  "ASK_FAMILY",
  "NEED_TO_THINK",
  "PAY_LATER",
  "ARTICLE_QUALITY",
  "GOOGLE_INDEXING",
  "WIKIPEDIA",
  "SOCIAL_VERIFICATION",
  "CERTIFICATE",
  "TIME",
  "PHOTO_REQUIREMENT",
  "HOW_FOUND_ME",
  "OTHER",
];

export function primaryObjection(kinds: readonly string[]): ObjectionKind | null {
  for (const candidate of PRIORITY) {
    if (kinds.includes(candidate)) return candidate;
  }
  return null;
}
