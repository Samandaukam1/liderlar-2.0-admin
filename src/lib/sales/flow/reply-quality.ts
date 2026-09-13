/**
 * JAVOB SIFATI DARVOZASI (31-band).
 *
 * Model javobi mijozga ketishdan oldin shu yerdan o'tadi. Maqsad —
 * FAKT VA XAVFSIZLIK: uslub masalasi emas.
 *
 * Ikki xil natija bor va ular ATAYLAB farqlanadi:
 *   · `block` — bu javob hech qachon yuborilmaydi (yolg'on va'da,
 *     kafolat, to'qilgan raqam). Fallback ishlatiladi.
 *   · `warn` — yuborsa bo'ladi, lekin yozib qo'yiladi.
 *
 * SOF MODUL.
 */

import { normalizeForMatch } from "../text-normalize.ts";

export const QUALITY_VIOLATIONS = [
  "guaranteed_ranking",
  "guaranteed_wikipedia",
  "guaranteed_verification",
  "guaranteed_admission",
  "government_affiliation",
  "fake_urgency",
  "invented_discount",
  "payment_confirmed_claim",
  "human_impersonation",
  "unsupported_number",
  "empty",
  "too_long",
] as const;
export type QualityViolation = (typeof QUALITY_VIOLATIONS)[number];

export const QUALITY_VIOLATION_LABELS: Record<QualityViolation, string> = {
  guaranteed_ranking: "Google’da o‘rin kafolati berilgan",
  guaranteed_wikipedia: "Wikipedia kafolati berilgan",
  guaranteed_verification: "Ko‘k belgi kafolati berilgan",
  guaranteed_admission: "Grant/universitet natijasi kafolati berilgan",
  government_affiliation: "Davlat tashkiloti nomidan gapirilgan",
  fake_urgency: "To‘qilgan shoshilinchlik",
  invented_discount: "Tasdiqlanmagan chegirma",
  payment_confirmed_claim: "To‘lov tasdiqlangan deb aytilgan",
  human_impersonation: "O‘zini odam deb ko‘rsatgan",
  unsupported_number: "Manbada yo‘q son",
  empty: "Javob bo‘sh",
  too_long: "Javob juda uzun",
};

/** Bloklanadigan buzilishlar — qolganlari ogohlantirish. */
const BLOCKING: readonly QualityViolation[] = [
  "guaranteed_ranking",
  "guaranteed_wikipedia",
  "guaranteed_verification",
  "guaranteed_admission",
  "government_affiliation",
  "invented_discount",
  "payment_confirmed_claim",
  "human_impersonation",
  "unsupported_number",
  "empty",
];

interface Pattern {
  violation: QualityViolation;
  test: RegExp;
}

/**
 * Naqshlar ATAYLAB tor.
 *
 * Keng naqsh halol javobni ham bloklaydi: "Google'da chiqishi
 * mumkin" — to'g'ri gap, "Google'da birinchi o'rinda chiqasiz" —
 * yolg'on. Ikkalasida ham "google" bor, farq kafolat so'zida.
 */
const PATTERNS: readonly Pattern[] = [
  {
    violation: "guaranteed_ranking",
    test: /(google|gugl|qidiruv)[^.!?]{0,60}(kafolat|birinchi o'rin|birinchi orin|1-o'rin|top\s*1|albatta chiqa)/iu,
  },
  {
    violation: "guaranteed_ranking",
    test: /(kafolat|albatta)[^.!?]{0,40}(google|gugl|qidiruvda birinchi)/iu,
  },
  {
    violation: "guaranteed_wikipedia",
    test: /(wikipedi|vikipedi|википеди)\p{L}*[^.!?]{0,60}(kafolat|albatta|chiqarib beramiz|qo'shib beramiz|qoshib beramiz)/iu,
  },
  {
    violation: "guaranteed_verification",
    test: /(ko'k belgi|kok belgi|galochka|verified|tasdiqlangan akkaunt)[^.!?]{0,60}(kafolat|albatta|beramiz|olasiz)/iu,
  },
  {
    violation: "guaranteed_admission",
    test: /(grant|universitet|oliygoh|stipendiya)[^.!?]{0,60}(kafolat|albatta kirasiz|yutasiz|ta'minlaymiz)/iu,
  },
  {
    violation: "government_affiliation",
    test: /(biz|bizning)[^.!?]{0,40}(vazirlik|hokimiyat|davlat idorasi|davlat tashkiloti)(miz|imiz|ning vakili)/iu,
  },
  {
    violation: "fake_urgency",
    test: /(faqat bugun|bugungacha|ertadan (narx|qimmat)|oxirgi (kun|soat)|shoshiling|tezroq to'lang)/iu,
  },
  {
    violation: "payment_confirmed_claim",
    test: /(to'lovingiz|tolovingiz|to'lov)[^.!?]{0,30}(tasdiqlandi|qabul qilindi va tasdiqlandi|o'tdi)/iu,
  },
  {
    violation: "human_impersonation",
    test: /\b(men (bot|robot) emasman|men tirik odamman|men jonli operatorman)\b/iu,
  },
];

export interface QualityInput {
  body: string;
  /** Javobda uchraydigan, manbada yo'q sonlar (retrieval guard natijasi). */
  unsupportedNumbers: readonly string[];
  /** Tasdiqlangan bilimda chegirma bormi. */
  discountApproved: boolean;
  /** Suhbatdagi haqiqiy to'lov holati. */
  paymentStatus: string;
  /** Telegram bitta xabarda shuncha belgi qabul qiladi. */
  maxChars?: number;
}

export interface QualityResult {
  ok: boolean;
  blocked: QualityViolation[];
  warnings: QualityViolation[];
}

const DEFAULT_MAX_CHARS = 3500;

export function checkReplyQuality(input: QualityInput): QualityResult {
  const blocked: QualityViolation[] = [];
  const warnings: QualityViolation[] = [];
  const body = input.body ?? "";
  const normalized = normalizeForMatch(body);

  const add = (violation: QualityViolation) => {
    const bucket = BLOCKING.includes(violation) ? blocked : warnings;
    if (!bucket.includes(violation)) bucket.push(violation);
  };

  if (body.trim() === "") add("empty");
  if (body.length > (input.maxChars ?? DEFAULT_MAX_CHARS)) add("too_long");

  for (const { violation, test } of PATTERNS) {
    // To'lov da'vosi FAQAT haqiqatan to'lanmagan bo'lsa buzilish.
    // To'langan mijozga "to'lovingiz tasdiqlandi" deyish — rost gap.
    if (violation === "payment_confirmed_claim" && input.paymentStatus === "paid") continue;
    if (test.test(normalized)) add(violation);
  }

  // Chegirma faqat tasdiqlangan bilimda bo'lsa aytiladi.
  if (!input.discountApproved && /(chegirma|skidka|aksiya|arzonlashtir)/iu.test(normalized)) {
    add("invented_discount");
  }

  if (input.unsupportedNumbers.length > 0) add("unsupported_number");

  return { ok: blocked.length === 0, blocked, warnings };
}

/**
 * Qayta yaratishda modelga beriladigan tuzatish ko'rsatmasi.
 *
 * Bir marta qayta uriniladi (31-band). Ikkinchi marta ham yiqilsa —
 * fallback va odam. Cheksiz qayta urinish ham pul sarflaydi, ham
 * mijozni kuttiradi.
 */
export function buildCorrectionInstruction(violations: readonly QualityViolation[]): string {
  const lines = ["OLDINGI JAVOBING QABUL QILINMADI. Sabab:"];
  for (const violation of violations) lines.push(`- ${QUALITY_VIOLATION_LABELS[violation]}`);
  lines.push(
    "",
    "Qaytadan yoz. Kafolat berma, raqam to‘qima, chegirma o‘ylab topma,",
    "to‘lovni tasdiqlangan deb aytma va o‘zingni odam deb ko‘rsatma.",
    "Faqat tasdiqlangan ma’lumotga tayan. Bilmasang — bilmasligingni ayt.",
  );
  return lines.join("\n");
}
