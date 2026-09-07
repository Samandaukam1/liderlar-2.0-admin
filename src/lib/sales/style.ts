/**
 * Yozuv uslubini o'rganish.
 *
 * FAKT EMAS, USLUB. Bu modul suhbatdan "narx 500 000 so'm" faktini
 * chiqarmaydi — u faqat "narx qanday aytiladi" shaklini o'lchaydi.
 * Ajratish ikki qoida bilan MAJBURLANADI:
 *
 *   1) Profilga tushadigan har bir matn `maskNumbers` dan o'tadi, ya'ni
 *      barcha son {SON}/{NARX} ga aylanadi. Shu sababli uslub profilida
 *      hech qachon haqiqiy narx, sana yoki miqdor turmaydi.
 *   2) Salomlashish, CTA va e'tiroz ochqichlari erkin matndan emas,
 *      QAT'IY LUG'ATDAN olinadi. Shu sababli mijoz ismi yoki tashkilot
 *      nomi profilga tushib qolmaydi.
 *
 * Namunalar faqat CHIQUVCHI (outgoing) xabarlar — biz o'z uslubimizni
 * o'rganamiz, mijozning uslubini emas.
 *
 * Yangi suhbat kuchliroq og'irlik oladi: `recency.ts` ga qarang.
 */

import { DEFAULT_RECENCY_BUCKETS, weightForDate, type RecencyBucket } from "./recency.ts";
import type { SalesDirection } from "./types.ts";

/* ------------------------------- lug'atlar ------------------------------ */

/** Boshlanish iboralari. Erkin matn emas — ism sizib chiqmasligi uchun. */
const GREETINGS = [
  "assalomu alaykum",
  "assalomu aleykum",
  "vaalaykum assalom",
  "va alaykum assalom",
  "salom",
  "xayrli tong",
  "xayrli kun",
  "xayrli kech",
  "hayrli kun",
  "hurmatli",
  "здравствуйте",
  "добрый день",
  "hello",
  "hi",
];

const CTA_PHRASES = [
  "ariza qoldiring",
  "ariza yuboring",
  "ro‘yxatdan o‘ting",
  "royxatdan oting",
  "bog‘laning",
  "boglaning",
  "qo‘ng‘iroq qiling",
  "qongiroq qiling",
  "havolani bosing",
  "havola orqali",
  "buyurtma bering",
  "to‘lovni amalga oshiring",
  "tolovni amalga oshiring",
  "tasdiqlang",
  "yuboring",
  "yozing",
  "kutamiz",
  "keling",
];

/** E'tirozga javob berishda ishlatiladigan yumshatuvchi ochqichlar. */
const OBJECTION_OPENERS = [
  "tushunaman",
  "albatta",
  "aynan shu sababli",
  "shuning uchun",
  "haqiqatan ham",
  "afsuski",
  "to‘g‘ri aytasiz",
  "togri aytasiz",
  "lekin",
  "ammo",
  "shunday bo‘lsa-da",
];

/** Narx haqida gap ketayotganini bildiruvchi belgilar. */
const PRICE_MARKERS = /(so‘m|so'm|som|сум|usd|\$|ming|mln|million|narx|to‘lov|tolov|chegirma)/i;

/** "siz" va "sen" murojaat shakllarining ko'rsatkichlari. */
const SIZ_MARKERS = /\b(siz|sizga|sizni|sizning|sizlar|sizda|sizdan|marhamat|iltimos)\b/gi;
const SEN_MARKERS = /\b(sen|senga|seni|sening|senda|sendan|sanga)\b/gi;

/** Norasmiylik belgilari — ohangni baholashda. */
const INFORMAL_MARKERS = /\b(oka|aka|opa|bro|yaxshi|zo‘r|zor|ok|okey|hop|mayli|xo‘p|xop)\b/gi;

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/* -------------------------------- tiplar -------------------------------- */

export interface StyleSample {
  text: string | null;
  sentAt: string;
  direction: SalesDirection;
  conversationId?: string;
}

export interface WeightedPhrase {
  phrase: string;
  /** Og'irlangan uchrash soni. */
  weight: number;
  /** Namunalar ichidagi ulush, 0–1. */
  share: number;
}

export interface StyleProfile {
  greeting: { usageRate: number; top: WeightedPhrase[] };
  address: {
    form: "siz" | "sen" | "aralash" | "noaniq";
    sizShare: number;
    senShare: number;
  };
  sentence: {
    averageWords: number;
    averageChars: number;
    averageSentencesPerMessage: number;
  };
  emoji: { usageRate: number; perMessage: number; top: WeightedPhrase[] };
  tone: { formalityScore: number; label: "rasmiy" | "yarim rasmiy" | "norasmiy" };
  /** Narx SHAKLI. Sonlar maskalangan — haqiqiy narx bu yerda YO'Q. */
  price: { mentionRate: number; templates: string[] };
  objection: { responseRate: number; openers: WeightedPhrase[] };
  cta: { usageRate: number; top: WeightedPhrase[] };
  punctuation: {
    questionRate: number;
    exclamationRate: number;
    ellipsisRate: number;
    averageMarksPerMessage: number;
  };
  script: {
    latinShare: number;
    cyrillicShare: number;
    dominant: "lotin" | "kirill" | "aralash" | "noaniq";
  };
}

export interface StyleAnalysis {
  profile: StyleProfile;
  sampleMessageCount: number;
  sampleConversationCount: number;
  /** Og'irliklar qo'llangandan keyingi yig'indi — "qancha ishonchli". */
  weightedSample: number;
}

/* ------------------------------- yordamchi ------------------------------ */

/**
 * Barcha sonni maskalaydi. Uslub profiliga fakt tushmasligining
 * BIRINCHI to'sig'i — profilga yoziladigan har bir satr shundan o'tadi.
 */
export function maskNumbers(text: string): string {
  return text
    // "500 000", "1 200 000", "500000", "12.5"
    .replace(/\d[\d\s.,]*\d|\d/g, "{SON}")
    // faqat KETMA-KET maskalar siqiladi: "{SON} {SON}" -> "{SON}".
    // Oradagi so'z saqlanadi, ya'ni "{SON} oy" "{SON}oy" ga aylanmaydi.
    .replace(/\{SON\}(?:[\s.,]*\{SON\})+/g, "{SON}");
}

const round = (value: number, digits = 3): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?…]+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function countMatches(text: string, pattern: RegExp): number {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return (text.match(re) ?? []).length;
}

/** Lug'atdagi qaysi iboralar matnda uchraganini qaytaradi. */
function matchedPhrases(lowerText: string, dictionary: readonly string[]): string[] {
  return dictionary.filter((phrase) => lowerText.includes(phrase));
}

function topPhrases(
  tally: Map<string, number>,
  totalWeight: number,
  limit = 5,
): WeightedPhrase[] {
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([phrase, weight]) => ({
      phrase,
      weight: round(weight, 2),
      share: totalWeight > 0 ? round(weight / totalWeight) : 0,
    }));
}

const EMPTY_PROFILE: StyleProfile = {
  greeting: { usageRate: 0, top: [] },
  address: { form: "noaniq", sizShare: 0, senShare: 0 },
  sentence: { averageWords: 0, averageChars: 0, averageSentencesPerMessage: 0 },
  emoji: { usageRate: 0, perMessage: 0, top: [] },
  tone: { formalityScore: 0, label: "yarim rasmiy" },
  price: { mentionRate: 0, templates: [] },
  objection: { responseRate: 0, openers: [] },
  cta: { usageRate: 0, top: [] },
  punctuation: {
    questionRate: 0,
    exclamationRate: 0,
    ellipsisRate: 0,
    averageMarksPerMessage: 0,
  },
  script: { latinShare: 0, cyrillicShare: 0, dominant: "noaniq" },
};

/* -------------------------------- tahlil -------------------------------- */

export function analyzeStyle(
  samples: readonly StyleSample[],
  options: {
    now?: string | Date;
    buckets?: readonly RecencyBucket[];
    maxPriceTemplates?: number;
  } = {},
): StyleAnalysis {
  const now = options.now ?? new Date();
  const buckets = options.buckets ?? DEFAULT_RECENCY_BUCKETS;
  const maxPriceTemplates = options.maxPriceTemplates ?? 5;

  // Faqat bizning xabarlarimiz va faqat matni borlari.
  const usable = samples.filter(
    (s) => s.direction === "outgoing" && typeof s.text === "string" && s.text.trim() !== "",
  );

  if (usable.length === 0) {
    return {
      profile: EMPTY_PROFILE,
      sampleMessageCount: 0,
      sampleConversationCount: 0,
      weightedSample: 0,
    };
  }

  let totalWeight = 0;
  let greetingWeight = 0;
  let sizWeight = 0;
  let senWeight = 0;
  let wordsWeight = 0;
  let charsWeight = 0;
  let sentencesWeight = 0;
  let emojiMessageWeight = 0;
  let emojiCountWeight = 0;
  let priceWeight = 0;
  let objectionWeight = 0;
  let ctaWeight = 0;
  let questionWeight = 0;
  let exclamationWeight = 0;
  let ellipsisWeight = 0;
  let marksWeight = 0;
  let latinWeight = 0;
  let cyrillicWeight = 0;
  let informalWeight = 0;

  const greetingTally = new Map<string, number>();
  const ctaTally = new Map<string, number>();
  const objectionTally = new Map<string, number>();
  const emojiTally = new Map<string, number>();
  const priceTemplates = new Map<string, number>();
  const conversations = new Set<string>();

  for (const sample of usable) {
    const text = (sample.text ?? "").trim();
    const lower = text.toLowerCase();
    const weight = weightForDate(sample.sentAt, now, buckets);
    if (weight <= 0) continue;

    totalWeight += weight;
    if (sample.conversationId) conversations.add(sample.conversationId);

    // --- salomlashish ---
    const greetings = matchedPhrases(lower.slice(0, 60), GREETINGS);
    if (greetings.length > 0) {
      greetingWeight += weight;
      // Eng uzun moslik — "assalomu alaykum" ni "salom" bosib ketmasin.
      const best = greetings.reduce((a, b) => (b.length > a.length ? b : a));
      greetingTally.set(best, (greetingTally.get(best) ?? 0) + weight);
    }

    // --- siz / sen ---
    const sizHits = countMatches(text, SIZ_MARKERS);
    const senHits = countMatches(text, SEN_MARKERS);
    if (sizHits > 0) sizWeight += weight;
    if (senHits > 0) senWeight += weight;

    // --- gap uzunligi ---
    const sentences = splitSentences(text);
    const words = text.split(/\s+/).filter(Boolean);
    wordsWeight += weight * (sentences.length > 0 ? words.length / sentences.length : words.length);
    charsWeight += weight * text.length;
    sentencesWeight += weight * sentences.length;

    // --- emoji ---
    const emojis = text.match(EMOJI_RE) ?? [];
    if (emojis.length > 0) emojiMessageWeight += weight;
    emojiCountWeight += weight * emojis.length;
    for (const emoji of emojis) {
      emojiTally.set(emoji, (emojiTally.get(emoji) ?? 0) + weight);
    }

    // --- narx aytish usuli (SONLAR MASKALANADI) ---
    if (PRICE_MARKERS.test(lower) && /\d/.test(text)) {
      priceWeight += weight;
      const priceSentence = sentences.find((s) => PRICE_MARKERS.test(s) && /\d/.test(s));
      if (priceSentence) {
        const template = maskNumbers(priceSentence).slice(0, 160);
        priceTemplates.set(template, (priceTemplates.get(template) ?? 0) + weight);
      }
    }

    // --- e'tirozga javob ---
    const objections = matchedPhrases(lower, OBJECTION_OPENERS);
    if (objections.length > 0) {
      objectionWeight += weight;
      for (const phrase of objections) {
        objectionTally.set(phrase, (objectionTally.get(phrase) ?? 0) + weight);
      }
    }

    // --- CTA ---
    const ctas = matchedPhrases(lower, CTA_PHRASES);
    if (ctas.length > 0) {
      ctaWeight += weight;
      for (const phrase of ctas) {
        ctaTally.set(phrase, (ctaTally.get(phrase) ?? 0) + weight);
      }
    }

    // --- tinish belgilari ---
    if (text.includes("?")) questionWeight += weight;
    if (text.includes("!")) exclamationWeight += weight;
    if (/\.{3}|…/.test(text)) ellipsisWeight += weight;
    marksWeight += weight * countMatches(text, /[.,!?;:—–…]/g);

    // --- yozuv ---
    const latin = countMatches(text, /[A-Za-z]/g);
    const cyrillic = countMatches(text, /[Ѐ-ӿ]/g);
    latinWeight += weight * latin;
    cyrillicWeight += weight * cyrillic;

    // --- ohang ---
    // `countMatches` har safar yangi RegExp yasaydi: global `lastIndex`
    // holati oldingi xabardan qolib, keyingisini o'tkazib yubormaydi.
    if (countMatches(lower, INFORMAL_MARKERS) > 0) informalWeight += weight;
  }

  if (totalWeight <= 0) {
    return {
      profile: EMPTY_PROFILE,
      sampleMessageCount: usable.length,
      sampleConversationCount: conversations.size,
      weightedSample: 0,
    };
  }

  const rate = (value: number) => round(value / totalWeight);

  const sizShare = rate(sizWeight);
  const senShare = rate(senWeight);
  const addressForm: StyleProfile["address"]["form"] =
    sizShare === 0 && senShare === 0
      ? "noaniq"
      : senShare > sizShare * 1.2
        ? "sen"
        : sizShare > senShare * 1.2
          ? "siz"
          : "aralash";

  const letters = latinWeight + cyrillicWeight;
  const latinShare = letters > 0 ? round(latinWeight / letters) : 0;
  const cyrillicShare = letters > 0 ? round(cyrillicWeight / letters) : 0;
  const dominant: StyleProfile["script"]["dominant"] =
    letters === 0
      ? "noaniq"
      : latinShare >= 0.75
        ? "lotin"
        : cyrillicShare >= 0.75
          ? "kirill"
          : "aralash";

  // Rasmiylik: siz-murojaat va salomlashish ko'taradi; emoji, undov va
  // norasmiy so'zlar tushiradi. 0–1 oralig'ida qisiladi.
  const formalityScore = round(
    Math.min(
      1,
      Math.max(
        0,
        0.5 +
          0.3 * sizShare -
          0.3 * senShare +
          0.15 * rate(greetingWeight) -
          0.2 * rate(emojiMessageWeight) -
          0.1 * rate(exclamationWeight) -
          0.15 * rate(informalWeight),
      ),
    ),
    2,
  );

  const profile: StyleProfile = {
    greeting: {
      usageRate: rate(greetingWeight),
      top: topPhrases(greetingTally, totalWeight),
    },
    address: { form: addressForm, sizShare, senShare },
    sentence: {
      averageWords: round(wordsWeight / totalWeight, 1),
      averageChars: round(charsWeight / totalWeight, 1),
      averageSentencesPerMessage: round(sentencesWeight / totalWeight, 1),
    },
    emoji: {
      usageRate: rate(emojiMessageWeight),
      perMessage: round(emojiCountWeight / totalWeight, 2),
      top: topPhrases(emojiTally, totalWeight),
    },
    tone: {
      formalityScore,
      label: formalityScore >= 0.66 ? "rasmiy" : formalityScore >= 0.4 ? "yarim rasmiy" : "norasmiy",
    },
    price: {
      mentionRate: rate(priceWeight),
      templates: [...priceTemplates.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxPriceTemplates)
        .map(([template]) => template),
    },
    objection: {
      responseRate: rate(objectionWeight),
      openers: topPhrases(objectionTally, totalWeight),
    },
    cta: { usageRate: rate(ctaWeight), top: topPhrases(ctaTally, totalWeight) },
    punctuation: {
      questionRate: rate(questionWeight),
      exclamationRate: rate(exclamationWeight),
      ellipsisRate: rate(ellipsisWeight),
      averageMarksPerMessage: round(marksWeight / totalWeight, 1),
    },
    script: { latinShare, cyrillicShare, dominant },
  };

  return {
    profile,
    sampleMessageCount: usable.length,
    sampleConversationCount: conversations.size,
    weightedSample: round(totalWeight, 2),
  };
}
