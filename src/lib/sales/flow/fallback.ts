/**
 * JIM QOLMASLIK (3-band) — tizimning eng muhim qoidasi.
 *
 * MUAMMO: ilgari AI bir necha holatda MIJOZGA UMUMAN JAVOB
 * BERMASDI — bilim topilmasa, model raqam to'qisa, niyat
 * aniqlanmasa, ssenariyda qadam bo'lmasa. Texnik jihatdan bu
 * "xavfsiz" qaror edi: noto'g'ri gapirgandan ko'ra jim turgan
 * yaxshi. Sotuv suhbatida esa bu eng yomon natija: mijoz savol
 * berib javob olmaydi va ketadi. U tizimning ehtiyotkorligini
 * ko'rmaydi — e'tiborsizlikni ko'radi.
 *
 * YECHIM: javob DOIM bo'ladi, lekin FAKT O'YLAB TOPILMAYDI.
 * Bilim yo'q bo'lsa, AI buni tan oladi, aniqlashtirishni va'da
 * qiladi va suhbatni davom ettiradigan savol beradi.
 *
 * TAKRORLANMASLIK: bir xil matn ikki marta kelsa, bu "javob"
 * emas, avtojavob bo'lib ko'rinadi. Shuning uchun variantlar
 * navbat bilan ishlatiladi — TASODIFAN emas, oldin nechta
 * fallback yuborilganiga qarab, ya'ni natija testda qat'iy.
 *
 * SOF MODUL.
 */

import type { SalesStage } from "./stages.ts";

export const FALLBACK_REASONS = [
  "missing_knowledge",
  "unsupported_numbers",
  "generation_failed",
  "no_transition",
  "terminal_stage",
  "low_confidence",
  "unclear_message",
] as const;
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

export const FALLBACK_REASON_LABELS: Record<FallbackReason, string> = {
  missing_knowledge: "Tasdiqlangan bilim topilmadi",
  unsupported_numbers: "Javobda manbada yo‘q son bor edi",
  generation_failed: "Model javob bermadi",
  no_transition: "Ssenariyda bu javob uchun qadam yo‘q",
  terminal_stage: "Ssenariy tugagan bosqich",
  low_confidence: "Ishonch past",
  unclear_message: "Xabar tushunarsiz",
};

/**
 * Bilim yetishmaganda.
 *
 * HECH BIR VARIANTDA FAKT YO'Q: na narx, na muddat, na kafolat.
 * Har biri bitta ish qiladi — savolni odamga o'tkazishni va'da
 * qiladi va suhbatni ochiq qoldiradi.
 */
const MISSING_KNOWLEDGE_VARIANTS: readonly string[] = [
  "Bu masalada sizga noto‘g‘ri ma’lumot berib qo‘ymaslik uchun aniqlashtirib, " +
    "qisqa vaqtda javob yozaman. Shu orada maqola jarayoni bo‘yicha savolingiz bo‘lsa, javob beraman.",
  "Buni aniq aytishim uchun tekshirib ko‘rishim kerak — taxmin qilib aytmayman. " +
    "Javobini yozib yuboraman. Boshqa savolingiz bormi?",
  "Savolingizni oldim. Aniq javobini berish uchun hamkasbim bilan aniqlashtiraman, " +
    "shundan keyin yozaman. Jarayonning qolgan qismi bo‘yicha yordam berib turaymi?",
];

/** Model raqam to'qiganda — javob YUBORILMAYDI, lekin jim ham qolinmaydi. */
const UNSUPPORTED_NUMBER_VARIANTS: readonly string[] = [
  "Bu savolda aniq raqam muhim, shuning uchun xotiradan aytmayman — " +
    "tasdiqlangan ma’lumotni tekshirib yozaman.",
  "Raqamlar bo‘yicha xato qilmaslik uchun aniq ma’lumotni tekshirib, shu yerga yozaman.",
];

/** Model yiqilganda — mijoz buni bilishi shart emas, lekin javobsiz qolmasin. */
const GENERATION_FAILED_VARIANTS: readonly string[] = [
  "Xabaringizni oldim. Javobni biroz aniqlashtirib yozaman.",
  "Yozganingizni ko‘rdim, javobini tayyorlab yuboraman.",
];

/** Ssenariyda qadam yo'q, lekin suhbat davom etadi. */
const NO_TRANSITION_VARIANTS: readonly string[] = [
  "Tushundim. Shu bo‘yicha qanday yordam bera olaman?",
  "Qabul qildim. Sizni aynan nimasi ko‘proq qiziqtiryapti?",
];

/** Tushunarsiz xabar — "xa", "hmm", "ok" kabi. */
const UNCLEAR_VARIANTS: readonly string[] = [
  "To‘g‘ri tushunganimga ishonch hosil qilay: shu bo‘yicha davom etamizmi?",
  "Aniqlashtirib olsam: sizni qaysi tomoni ko‘proq qiziqtiryapti?",
];

export interface FallbackInput {
  reason: FallbackReason;
  stage: SalesStage;
  /** Shu suhbatda ilgari nechta fallback yuborilgan — takrorni oldini oladi. */
  previousFallbackCount: number;
  /** 18 dan kichik bo'lsa bosim o'tkazilmaydi. */
  isMinor?: boolean;
}

export interface FallbackReply {
  body: string;
  /** Bu javobdan keyin odam aralashuvi kerakmi. */
  requiresHuman: boolean;
}

function pick(variants: readonly string[], index: number): string {
  return variants[Math.abs(index) % variants.length];
}

/**
 * TO'XTASH CHEGARASI.
 *
 * Uchinchi fallback'dan keyin AI o'zi tuzata olmasligi aniq: u bir
 * xil narsani uch marta aytdi va suhbat oldinga ketmadi. Bu yerdan
 * keyin odamga o'tkaziladi — "tekshirib yozaman" degan va'dani
 * cheksiz takrorlash aldashdan farq qilmaydi.
 */
export const MAX_FALLBACKS_BEFORE_HUMAN = 3;

export function buildFallback(input: FallbackInput): FallbackReply {
  const index = input.previousFallbackCount;
  const requiresHuman = input.previousFallbackCount + 1 >= MAX_FALLBACKS_BEFORE_HUMAN;

  let body: string;
  switch (input.reason) {
    case "missing_knowledge":
    case "low_confidence":
      body = pick(MISSING_KNOWLEDGE_VARIANTS, index);
      break;
    case "unsupported_numbers":
      body = pick(UNSUPPORTED_NUMBER_VARIANTS, index);
      break;
    case "generation_failed":
      body = pick(GENERATION_FAILED_VARIANTS, index);
      break;
    case "no_transition":
    case "terminal_stage":
      body = pick(NO_TRANSITION_VARIANTS, index);
      break;
    case "unclear_message":
      body = pick(UNCLEAR_VARIANTS, index);
      break;
  }

  // Odamga o'tkazilayotganda va'da ANIQ bo'lsin: mijoz kimdan va
  // nimani kutayotganini bilishi kerak.
  if (requiresHuman) {
    body = `${body}\n\nAniqroq javob berish uchun mas’ul hamkasbim siz bilan bog‘lanadi.`;
  }

  return { body, requiresHuman };
}

/**
 * Mijoz javobi mazmunsiz qisqa bo'lsa ("xa", "ok", "hmm").
 *
 * Bu javobsizlik EMAS: mijoz javob berdi va javob kutyapti. Uni
 * e'tiborsiz qoldirish suhbatni o'ldiradi.
 */
const FILLER_TOKENS: readonly string[] = [
  "xa", "ha", "ok", "okey", "xop", "xo'p", "hmm", "hm", "aha", "uh",
  "ммм", "ок", "ха", "da", "да", "+", "👍", "🙏",
];

export function isFillerMessage(text: string | null | undefined): boolean {
  const value = (text ?? "").trim().toLowerCase().replace(/[.!?,\s]+$/g, "");
  if (value === "") return false;
  if (value.length > 12) return false;
  return FILLER_TOKENS.includes(value);
}
