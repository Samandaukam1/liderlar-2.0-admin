/**
 * TARIXIY BO'SHLIQLARNI TASNIFLASH (23-band).
 *
 * Ro'yxatda allaqachon ming atrofida yozuv bor va ularning
 * katta qismi savol emas: "Hop", "Rahmat", ".", odam ismlari.
 *
 * QATOR O'CHIRILMAYDI. Har yozuv tasnif oladi va savol
 * bo'lmaganlari ARXIVGA o'tadi — ya'ni navbatda ko'rinmaydi,
 * lekin tarix va tekshiruv imkoniyati saqlanadi (38-band).
 *
 * SOF MODUL — bot ishlatadigan AYNAN o'sha tasniflagichdan
 * foydalanadi. Ikki xil qoida bo'lsa, panel va bot bir xil
 * xabarni boshqacha baholardi.
 */

import { classifyMessageIntent, EMPTY_INTENT_CONTEXT } from "../flow/message-intent.ts";
import type { MessageIntent } from "../flow/message-intent.ts";

export const GAP_CLASSIFICATIONS = [
  "real_knowledge_gap",
  "case_specific",
  "conversational",
  "form_data",
  "noise",
  "unknown_review",
] as const;
export type GapClassification = (typeof GAP_CLASSIFICATIONS)[number];

export const GAP_CLASSIFICATION_LABELS: Record<GapClassification, string> = {
  real_knowledge_gap: "Haqiqiy bilim bo‘shlig‘i",
  case_specific: "Shaxsiy holat",
  conversational: "Oddiy muloqot",
  form_data: "Anketa / ism",
  noise: "Shovqin",
  unknown_review: "Ko‘rib chiqish kerak",
};

/** Navbatda faqat shular qoladi. */
export const QUEUE_CLASSIFICATIONS: readonly GapClassification[] = [
  "real_knowledge_gap",
  "unknown_review",
];

const INTENT_TO_CLASSIFICATION: Readonly<Record<MessageIntent, GapClassification>> = {
  greeting: "conversational",
  thanks: "conversational",
  acknowledgement: "conversational",
  confirmation: "conversational",
  decline: "conversational",
  affirmation: "conversational",
  negation: "conversational",
  continuation: "conversational",
  clarification: "conversational",
  action_confirmation: "conversational",
  attachment_reference: "conversational",
  payment_receipt_reference: "conversational",
  off_topic: "conversational",

  identity_data: "form_data",
  form_data: "form_data",

  spam_or_noise: "noise",

  status_question: "case_specific",
  complaint: "case_specific",
  human_request: "case_specific",

  knowledge_question: "real_knowledge_gap",
  process_question: "real_knowledge_gap",
  price_question: "real_knowledge_gap",
  follow_up_question: "real_knowledge_gap",

  /*
   * NOANIQ — O'CHIRILMAYDI, ODAMGA QOLDIRILADI.
   *
   * Shubhali yozuvni "shovqin" deb arxivlash haqiqiy savolni
   * yo'qotishi mumkin edi. Arxivlash arzon, yo'qotish qimmat.
   */
  ambiguous: "unknown_review",
};

export interface GapClassificationResult {
  classification: GapClassification;
  intent: MessageIntent;
  reason: string;
  /** Navbatdan chiqarilsinmi. */
  archive: boolean;
  /** `kind` ustuni uchun. */
  kind: "global" | "case";
}

/**
 * Bo'shliq yozuvini tasniflaydi.
 *
 * KONTEKST YO'Q: tarixiy yozuvda faqat savol matni saqlangan.
 * Shuning uchun natija bot ishlayotgandagidan ehtiyotkorroq
 * chiqadi — shubhalilar "ko'rib chiqish kerak" ga tushadi.
 */
export function classifyHistoricalGap(question: string | null | undefined): GapClassificationResult {
  const intent = classifyMessageIntent(question, {
    ...EMPTY_INTENT_CONTEXT,
    // Tarixiy yozuv har doim suhbat ichidan kelgan.
    hasHistory: true,
  });

  const classification = INTENT_TO_CLASSIFICATION[intent.intent];

  return {
    classification,
    intent: intent.intent,
    reason: `niyat: ${intent.intent}${intent.matched ? ` (${intent.matched})` : ""}`,
    archive: !QUEUE_CLASSIFICATIONS.includes(classification),
    kind: classification === "case_specific" ? "case" : "global",
  };
}

/** Bo'sh hisobot — sanoqlar shu shaklda yig'iladi. */
export function emptyCounts(): Record<GapClassification, number> {
  return {
    real_knowledge_gap: 0,
    case_specific: 0,
    conversational: 0,
    form_data: 0,
    noise: 0,
    unknown_review: 0,
  };
}
