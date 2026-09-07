/**
 * Test chat uchun BILIM TANLASH (retrieval).
 *
 * QOIDA: AI faqat shu yerdan chiqqan material bilan javob yozadi.
 * Tanlash sof va determinatsiyalangan — bir xil savolga har safar bir
 * xil manba to'plami keladi, ya'ni diagnostikadagi "3 ta knowledge"
 * tekshirib bo'ladigan fakt, modelning o'zi haqidagi bahosi emas.
 *
 * SOF MODUL: baza ham, model ham yo'q. Shuning uchun tanlash qoidalari
 * testda to'liq tekshiriladi.
 */

import { normalizeForMatch } from "./text-normalize.ts";
import { rankPatternsByOutcome } from "./aggregate.ts";
import type { KnowledgeCategory } from "./types.ts";

/* -------------------------------- kirish -------------------------------- */

export interface RetrievableKnowledge {
  id: string;
  category: KnowledgeCategory;
  question: string | null;
  answer: string;
  tags: string[];
  /** Ajratishdagi ishonch — teng ballda ustunlik beradi. */
  confidence: number;
}

export interface RetrievablePattern {
  id: string;
  intentKey: string;
  intentLabel: string;
  customerExample: string;
  responseExample: string;
  frequency: number;
  successCount: number;
  successRate: number | null;
}

/* ------------------------------ tokenizatsiya --------------------------- */

/**
 * Ma'no tashimaydigan so'zlar. Ular hisobga olinsa, "narxi qancha?" va
 * "ariza qanday?" bir xil ballga chiqib qolardi.
 */
const STOPWORDS = new Set([
  "va", "bilan", "uchun", "bu", "shu", "men", "siz", "sen", "u", "ular",
  "biz", "ham", "yoki", "lekin", "ammo", "agar", "qanday", "qancha",
  "nima", "kim", "qayer", "qachon", "bor", "yoq", "yo'q", "bormi",
  "ha", "salom", "assalomu", "alaykum", "rahmat", "mumkinmi", "kerak",
]);

export function tokenize(text: string): string[] {
  return normalizeForMatch(text)
    .split(/[^\p{L}\p{N}']+/u)
    .map((token) => token.replace(/^'+|'+$/g, ""))
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

/* --------------------------- turkum yaqinligi --------------------------- */

/**
 * Niyat -> qaysi turkumdagi bilim mos keladi.
 *
 * Bu qo'lda yozilgan xarita, chunki turkum va niyat ikki xil o'lchov:
 * "narx savoli" ga `price` ham, `faq` ham, `answer` ham javob bo'lishi
 * mumkin, lekin `application` emas. Xaritada yo'q niyat uchun turkum
 * bonusi berilmaydi — faqat matn mosligi ishlaydi.
 */
export const INTENT_CATEGORY_AFFINITY: Record<string, readonly KnowledgeCategory[]> = {
  PRICE_QUESTION: ["price", "faq", "answer", "service_fact"],
  ARTICLE_PRICE: ["price", "faq", "answer"],
  SERVICE_BENEFIT: ["service_fact", "sales_argument", "answer", "faq"],
  WHERE_PUBLISHED: ["service_fact", "post_article", "answer", "faq"],
  TRUST_QUESTION: ["sales_argument", "service_fact", "faq", "objection"],
  TIMELINE_QUESTION: ["service_fact", "faq", "answer"],
  ARTICLE_DEADLINE: ["service_fact", "faq", "answer"],
  PAYMENT_METHOD: ["payment", "faq", "answer"],
  APPLICATION_PROCESS: ["application", "cta", "faq", "answer"],
  ELIGIBILITY: ["service_fact", "faq", "answer"],
  AGE_LIMIT: ["service_fact", "faq", "answer"],
  CERTIFICATE: ["service_fact", "faq", "answer"],
  POST_QUESTION: ["post_article", "service_fact", "answer"],
  INSTAGRAM: ["post_article", "service_fact", "answer"],
  TELEGRAM: ["post_article", "service_fact", "answer"],
  WEBSITE: ["service_fact", "post_article", "answer"],
  EDIT_REQUEST: ["service_fact", "faq", "answer"],
  REFUND: ["payment", "faq", "objection", "answer"],
  OBJECTION_TOO_EXPENSIVE: ["objection", "sales_argument", "price"],
  OBJECTION_TRUST: ["objection", "sales_argument", "service_fact"],
  OBJECTION_LATER: ["objection", "follow_up", "sales_argument"],
  OBJECTION_THINKING: ["objection", "follow_up", "sales_argument"],
  OBJECTION_NO_MONEY: ["objection", "sales_argument", "price"],
  DOUBT: ["objection", "sales_argument", "service_fact"],
};

/* -------------------------------- ballash -------------------------------- */

export interface ScoredKnowledge {
  item: RetrievableKnowledge;
  score: number;
  /** Nega tanlangani — "Manbalarni ko'rish" oynasida ko'rsatiladi. */
  reasons: string[];
}

const CATEGORY_BONUS = 2;
const QUESTION_TOKEN_WEIGHT = 2;
const ANSWER_TOKEN_WEIGHT = 1;
const TAG_TOKEN_WEIGHT = 1.5;

export function scoreKnowledge(
  item: RetrievableKnowledge,
  queryTokens: readonly string[],
  intentKey: string | null,
): ScoredKnowledge {
  const reasons: string[] = [];
  let score = 0;

  const affinity = intentKey ? INTENT_CATEGORY_AFFINITY[intentKey] : undefined;
  if (affinity?.includes(item.category)) {
    // Turkum mosligi eng kuchli signal: niyat allaqachon aniqlangan.
    const rank = affinity.indexOf(item.category);
    score += CATEGORY_BONUS * (1 - rank / (affinity.length + 1));
    reasons.push(`turkum mos (${item.category})`);
  }

  const questionTokens = new Set(tokenize(item.question ?? ""));
  const answerTokens = new Set(tokenize(item.answer));
  const tagTokens = new Set(item.tags.flatMap((tag) => tokenize(tag)));

  let overlap = 0;
  for (const token of new Set(queryTokens)) {
    if (questionTokens.has(token)) {
      score += QUESTION_TOKEN_WEIGHT;
      overlap += 1;
    } else if (tagTokens.has(token)) {
      score += TAG_TOKEN_WEIGHT;
      overlap += 1;
    } else if (answerTokens.has(token)) {
      score += ANSWER_TOKEN_WEIGHT;
      overlap += 1;
    }
  }
  if (overlap > 0) reasons.push(`${overlap} ta so‘z mos keldi`);

  // Ajratishdagi ishonch faqat teng ballni ajratadi, ustun signal emas.
  score += item.confidence * 0.5;

  return { item, score, reasons };
}

export interface KnowledgeSelection {
  items: ScoredKnowledge[];
  /** Umuman moslik topilmadi — MISSING_KNOWLEDGE holati shundan chiqadi. */
  empty: boolean;
}

/** Shundan past ballli yozuv "mos" deb hisoblanmaydi. */
export const MIN_KNOWLEDGE_SCORE = 1.5;

export function selectKnowledge(
  items: readonly RetrievableKnowledge[],
  options: { query: string; intentKey: string | null; limit?: number },
): KnowledgeSelection {
  const queryTokens = tokenize(options.query);
  const limit = options.limit ?? 6;

  const scored = items
    .map((item) => scoreKnowledge(item, queryTokens, options.intentKey))
    // Chegara MUHIM: chegarasiz har savolga tasodifiy bilim biriktirilib,
    // "3 ta knowledge topildi" degan yozuv ma'nosini yo'qotardi.
    .filter((entry) => entry.score >= MIN_KNOWLEDGE_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { items: scored, empty: scored.length === 0 };
}

/**
 * Shu niyatdagi javob shablonlari.
 *
 * Saralash `rankPatternsByOutcome` bilan — ya'ni "eng ko'p ishlatilgan"
 * emas, "eng yaxshi natija bergan" variant birinchi bo'ladi va natijasi
 * noma'lumlar oxirida qoladi. Bu qoida Javoblar sahifasi bilan BIR XIL
 * funksiyadan keladi, shuning uchun ikkisi hech qachon ajralib ketmaydi.
 */
export function selectPatterns(
  patterns: readonly RetrievablePattern[],
  options: { intentKey: string | null; limit?: number },
): RetrievablePattern[] {
  if (!options.intentKey) return [];
  const matching = patterns.filter((pattern) => pattern.intentKey === options.intentKey);
  return rankPatternsByOutcome(matching).slice(0, options.limit ?? 5);
}

/* ------------------------------- ishonch -------------------------------- */

export interface ConfidenceInput {
  intentResolved: boolean;
  intentKnown: boolean;
  knowledgeCount: number;
  patternCount: number;
  hasStyleProfile: boolean;
}

/**
 * Javob ishonchi — RETRIEVAL KUCHIDAN hisoblanadi, modeldan so'ralmaydi.
 *
 * Modeldan "o'zingga necha foiz ishonasan?" deb so'rash ma'nosiz raqam
 * beradi: model bilmagan narsasini ham ishonch bilan yozadi. Bu yerdagi
 * formula esa tekshirib bo'ladigan narsalarni sanaydi — niyat
 * aniqlandimi, nechta tasdiqlangan bilim topildi, uslub profili bormi.
 */
export function computeConfidence(input: ConfidenceInput): number {
  if (!input.intentResolved && input.knowledgeCount === 0 && input.patternCount === 0) return 0;

  let score = 0;
  if (input.intentResolved) score += 0.15;
  if (input.intentKnown) score += 0.1;
  // Bilim eng og'ir signal: javobning FAKTI shundan keladi.
  score += Math.min(1, input.knowledgeCount / 3) * 0.35;
  score += Math.min(1, input.patternCount / 3) * 0.25;
  if (input.hasStyleProfile) score += 0.15;

  return Math.round(Math.min(1, score) * 100) / 100;
}

/**
 * Tasdiqlangan material topilmadi.
 *
 * Faqat shu holatda AI'ga "fakt aytma" deb buyuriladi va diagnostikada
 * MISSING_KNOWLEDGE ko'rsatiladi.
 */
export function isMissingKnowledge(
  knowledge: readonly ScoredKnowledge[],
  patterns: readonly RetrievablePattern[],
): boolean {
  return knowledge.length === 0 && patterns.length === 0;
}

/* --------------------------- gallyutsinatsiya to‘sig‘i -------------------- */

/**
 * Javobda TASDIQLANMAGAN son bormi.
 *
 * Eng xavfli gallyutsinatsiya — o'ylab topilgan narx. Model qanchalik
 * qattiq ogohlantirilmasin, ba'zan raqam to'qiydi. Shuning uchun javob
 * yaratilgandan KEYIN ham tekshiriladi: javobdagi har bir son manba
 * matnlarida uchrashi shart.
 *
 * Kichik sonlar (tartib raqami "1.", "2.") va yil ko'rinishidagi qiymatlar
 * tashqarida qoldiriladi — ular fakt da'vosi emas.
 */
export function findUnsupportedNumbers(
  reply: string,
  allowedTexts: readonly string[],
): string[] {
  // Manbadagi sonlar TO'PLAM sifatida yig'iladi, bitta satrga
  // birlashtirilmaydi. Birlashtirilsa "5000" qiymati "500000" ichidan
  // topilib, o'ylab topilgan son tasdiqlangan deb ko'rinardi.
  const allowed = new Set(allowedTexts.flatMap(numberTokens));
  const found = new Set<string>();

  for (const match of reply.matchAll(NUMBER_RE)) {
    const raw = match[0].trim();
    const digits = raw.replace(/\D+/g, "");
    if (digits.length === 0) continue;
    // Bitta xonali son fakt da'vosi emas ("2 kun ichida").
    if (digits.length <= 1) continue;
    // Ro'yxat raqami ("1." / "2)") — mazmun emas, struktura.
    if (isListMarker(reply, match.index ?? 0, raw)) continue;
    if (allowed.has(digits)) continue;
    found.add(raw);
  }

  return [...found];
}

/** "500 000" ham, "500000" ham bir xil kalitga tushadi. */
const NUMBER_RE = /\d[\d\s.,]*\d|\d+/g;

function numberTokens(text: string): string[] {
  return [...text.matchAll(NUMBER_RE)].map((match) => match[0].replace(/\D+/g, ""));
}

/** Satr boshida turgan va nuqta/qavs bilan tugagan raqam — ro'yxat belgisi. */
function isListMarker(reply: string, index: number, raw: string): boolean {
  const before = reply.slice(0, index);
  const atLineStart = before === "" || /[\n\r]\s*$/.test(before);
  const after = reply.slice(index + raw.length);
  return atLineStart && /^[.)]\s/.test(after);
}
