/**
 * INSON USLUBI DATASETI — SOF MODUL.
 *
 * UCHTA AUDIT TOPILMASI shu yerda hal qilinadi:
 *
 * 1. USLUB AI DAN O'RGANILARDI (19-band). Bot o'z javobini
 *    keyingi profilga namuna qilib olardi — ya'ni o'z xatosini
 *    mustahkamlardi. Endi FAQAT inson yozgan xabar o'rganiladi.
 *
 * 2. HAMMASI BITTA O'RTACHAGA QO'SHILARDI (20-band). 3 709
 *    belgili foydalar bloki va "xo'p" bitta "o'rtacha uzunlik"
 *    berardi. O'lchangan holat: median 42, o'rtacha 344 —
 *    sakkiz barobar farq. Endi har SINF alohida o'lchanadi va
 *    markaziy o'lchov sifatida MEDIANA ishlatiladi.
 *
 * 3. YOMON NAMUNA HAM O'RGANILARDI (21-band). Qo'pollik, katta
 *    harfli bosim, "..." bilan javob berish — bular uslub emas,
 *    xato. Ular alohida belgilanadi va tavsiyaga chiqmaydi.
 */

import { normalizeForMatch } from "../text-normalize.ts";

/* ------------------------------ manba turi ------------------------------ */

/** Xabarni kim yozgan. Uslub FAQAT `human` dan o'rganiladi. */
export type MessageOrigin = "customer" | "human" | "ai" | "system" | "unknown";

export interface StyleCandidate {
  text: string | null;
  sentAt: string;
  origin: MessageOrigin;
  conversationId: string;
  /** Mijozga yetib borganmi. Yetmagan xabar uslub namunasi emas. */
  delivered: boolean;
  deleted: boolean;
  simulated: boolean;
}

export const EXCLUSION_KEYS = [
  "ai",
  "system",
  "customer",
  "unknown_origin",
  "deleted",
  "simulated",
  "undelivered",
  "empty",
] as const;
export type ExclusionKey = (typeof EXCLUSION_KEYS)[number];

export const EXCLUSION_LABELS: Record<ExclusionKey, string> = {
  ai: "AI yozgan",
  system: "tizim xabari",
  customer: "mijoz xabari",
  unknown_origin: "kelib chiqishi noma’lum",
  deleted: "o‘chirilgan",
  simulated: "simulyatsiya",
  undelivered: "yetkazilmagan",
  empty: "matnsiz",
};

export interface DatasetSelection {
  kept: StyleCandidate[];
  excluded: Record<ExclusionKey, number>;
  excludedTotal: number;
}

/**
 * Datasetni tanlaydi va NIMA UCHUN chiqarib tashlanganini sanaydi.
 *
 * Sanoq shart: "1 000 xabar o'rganildi" degan da'vo, aslida 400
 * tasi tashlangan bo'lsa, yolg'on bo'ladi. Admin ikkala sonni
 * ham ko'radi.
 */
export function selectHumanDataset(
  candidates: readonly StyleCandidate[],
): DatasetSelection {
  const excluded: Record<ExclusionKey, number> = {
    ai: 0,
    system: 0,
    customer: 0,
    unknown_origin: 0,
    deleted: 0,
    simulated: 0,
    undelivered: 0,
    empty: 0,
  };
  const kept: StyleCandidate[] = [];

  for (const candidate of candidates) {
    // Tartib muhim: eng aniq sabab birinchi sanaladi.
    if (candidate.origin === "ai") { excluded.ai += 1; continue; }
    if (candidate.origin === "system") { excluded.system += 1; continue; }
    if (candidate.origin === "customer") { excluded.customer += 1; continue; }
    if (candidate.origin === "unknown") { excluded.unknown_origin += 1; continue; }
    if (candidate.deleted) { excluded.deleted += 1; continue; }
    if (candidate.simulated) { excluded.simulated += 1; continue; }
    if (!candidate.delivered) { excluded.undelivered += 1; continue; }
    if (!candidate.text || candidate.text.trim() === "") { excluded.empty += 1; continue; }
    kept.push(candidate);
  }

  const excludedTotal = Object.values(excluded).reduce((sum, n) => sum + n, 0);
  return { kept, excluded, excludedTotal };
}

/* ------------------------------- sinflar -------------------------------- */

export const MESSAGE_CLASSES = [
  "greeting",
  "short_operational",
  "explanation",
  "objection_response",
  "cta",
  "followup",
  "payment_instruction",
  "support",
  "complaint_handling",
  "canonical_template",
] as const;
export type MessageClass = (typeof MESSAGE_CLASSES)[number];

export const MESSAGE_CLASS_LABELS: Record<MessageClass, string> = {
  greeting: "Salomlashish",
  short_operational: "Qisqa operatsion javob",
  explanation: "Tushuntirish",
  objection_response: "E’tirozga javob",
  cta: "Keyingi qadam (CTA)",
  followup: "Eslatma",
  payment_instruction: "To‘lov ko‘rsatmasi",
  support: "Texnik yordam",
  complaint_handling: "Shikoyat bilan ishlash",
  canonical_template: "Kanonik shablon",
};

/** Shundan uzun xabar — tayyor blok, jonli yozuv emas. */
const CANONICAL_TEMPLATE_CHARS = 1000;
/** Shundan qisqa xabar — operatsion tasdiq. */
const SHORT_OPERATIONAL_CHARS = 80;

const GREETING_PATTERNS: readonly RegExp[] = [
  /\bassalomu\s+alaykum\b/i,
  /\bvaalaykum\b/i,
  /\bsalom\b/i,
  /\bxayrli\s+(tong|kun|kech)\b/i,
  /\bbog['’ʻ]?langaniz\s+uchun\s+rahmat\b/i,
];

const PAYMENT_PATTERNS: readonly RegExp[] = [
  /\bkarta(ga)?\b/i,
  /\bto['’ʻ]?lov(ni)?\s+(qiling|amalga)/i,
  /\bhisob\s+raqam/i,
  /\bchek(ni)?\s+(yubor|tashla)/i,
];

const CTA_PATTERNS: readonly RegExp[] = [
  /\byuboring\b/i,
  /\bto['’ʻ]?ldiring\b/i,
  /\bbosing\b/i,
  /\bkiriting\b/i,
  /\byozing\b/i,
  /\btanishib\s+chiqing\b/i,
  /\bo['’ʻ]?tkazing\b/i,
];

const SUPPORT_PATTERNS: readonly RegExp[] = [
  /\bko['’ʻ]?rib\s+chiq/i,
  /\bdizayner/i,
  /\btuzatamiz\b/i,
  /\bo['’ʻ]?zgartiramiz\b/i,
  /\btekshirib\s+ko['’ʻ]?r/i,
];

const COMPLAINT_PATTERNS: readonly RegExp[] = [
  /\buzr\b/i,
  /\bkechirasiz\b/i,
  /\bnoqulaylik\b/i,
  /\btushunaman\b/i,
];

const OBJECTION_RESPONSE_PATTERNS: readonly RegExp[] = [
  /\btushunarli\b/i,
  /\balbatta\b/i,
  /\bqo['’ʻ]?rqmang\b/i,
  /\bhech\s+qanday\s+majburiyat\b/i,
];

const FOLLOWUP_PATTERNS: readonly RegExp[] = [
  /\beslatib\b/i,
  /\bjavobingizni\s+kutyapmiz\b/i,
  /\bqarshi\s+emasmisiz\b/i,
  /\bhali\s+ham\s+qiziqasizmi\b/i,
];

/**
 * Xabarning sinfi.
 *
 * TARTIB QAT'IY: eng aniq belgi birinchi. Uzun kanonik blok
 * birinchi tekshiriladi, chunki uning ichida CTA ham, narx ham,
 * salom ham bor — boshqa tartibda u har xil sinfga tushib,
 * medianani buzardi.
 */
export function classifyMessage(text: string): MessageClass {
  const trimmed = text.trim();
  const normalized = normalizeForMatch(trimmed);

  if (trimmed.length >= CANONICAL_TEMPLATE_CHARS) return "canonical_template";
  if (FOLLOWUP_PATTERNS.some((p) => p.test(normalized))) return "followup";
  if (PAYMENT_PATTERNS.some((p) => p.test(normalized))) return "payment_instruction";
  if (COMPLAINT_PATTERNS.some((p) => p.test(normalized))) return "complaint_handling";
  if (SUPPORT_PATTERNS.some((p) => p.test(normalized))) return "support";

  // Salomlashish faqat XABAR BOSHIDA hisobga olinadi va xabar
  // qisqa bo'lsa: uzun taklif ichidagi "assalomu alaykum" —
  // salomlashish sinfi emas, u taklifning bir qismi.
  const head = normalized.slice(0, 60);
  if (GREETING_PATTERNS.some((p) => p.test(head)) && trimmed.length <= 120) return "greeting";

  if (OBJECTION_RESPONSE_PATTERNS.some((p) => p.test(normalized)) && trimmed.length > SHORT_OPERATIONAL_CHARS) {
    return "objection_response";
  }
  if (trimmed.length <= SHORT_OPERATIONAL_CHARS) return "short_operational";
  if (CTA_PATTERNS.some((p) => p.test(normalized)) && trimmed.length <= 300) return "cta";
  return "explanation";
}

/* ------------------------------ o'lchovlar ------------------------------ */

export interface LengthDistribution {
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  max: number;
  /** Ma'lumot uchun saqlanadi, XULOSA UCHUN ISHLATILMAYDI. */
  mean: number;
}

/**
 * Persentil — chiziqli interpolyatsiyasiz, "eng yaqin pastki"
 * usulida. Sabab: uzunlik butun son va interpolyatsiya
 * "42.5 belgi" kabi ma'nosiz qiymat berardi.
 */
export function percentile(sortedValues: readonly number[], fraction: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(fraction * sortedValues.length) - 1),
  );
  return sortedValues[index];
}

export function describeLengths(values: readonly number[]): LengthDistribution {
  if (values.length === 0) {
    return { n: 0, min: 0, p25: 0, median: 0, p75: 0, p90: 0, max: 0, mean: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    n: sorted.length,
    min: sorted[0],
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1],
    mean: Math.round(sum / sorted.length),
  };
}

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu;

export interface ClassMetrics {
  messageClass: MessageClass;
  label: string;
  chars: LengthDistribution;
  words: LengthDistribution;
  sentences: LengthDistribution;
  emojiRate: number;
  exclamationRate: number;
  uppercaseRate: number;
  greetingRate: number;
  questionRate: number;
  sizRate: number;
  senRate: number;
  share: number;
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 1000;
}

function countSentences(text: string): number {
  const parts = text.split(/[.!?\n]+/).map((part) => part.trim()).filter(Boolean);
  return Math.max(1, parts.length);
}

/** Katta harf bosimi: ko'p harfli xabarda harflarning yarmidan ko'pi bosh harf. */
export function isUppercasePressure(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length < 15) return false;
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  return upper / letters.length > 0.5;
}

export function metricsForClass(
  messageClass: MessageClass,
  texts: readonly string[],
  totalMessages: number,
): ClassMetrics {
  const chars = describeLengths(texts.map((text) => text.length));
  const words = describeLengths(
    texts.map((text) => text.split(/\s+/).filter(Boolean).length),
  );
  const sentences = describeLengths(texts.map(countSentences));

  const n = texts.length;
  let emoji = 0;
  let exclamation = 0;
  let uppercase = 0;
  let greeting = 0;
  let question = 0;
  let siz = 0;
  let sen = 0;

  for (const text of texts) {
    const normalized = normalizeForMatch(text);
    if (EMOJI_RE.test(text)) emoji += 1;
    EMOJI_RE.lastIndex = 0;
    if (text.includes("!")) exclamation += 1;
    if (isUppercasePressure(text)) uppercase += 1;
    if (GREETING_PATTERNS.some((p) => p.test(normalized.slice(0, 60)))) greeting += 1;
    if (text.includes("?")) question += 1;
    if (/\bsiz\b|\bsizga\b|\bsizning\b|\bsizni\b/.test(normalized)) siz += 1;
    if (/\bsen\b|\bsenga\b|\bsening\b|\bseni\b/.test(normalized)) sen += 1;
  }

  return {
    messageClass,
    label: MESSAGE_CLASS_LABELS[messageClass],
    chars,
    words,
    sentences,
    emojiRate: rate(emoji, n),
    exclamationRate: rate(exclamation, n),
    uppercaseRate: rate(uppercase, n),
    greetingRate: rate(greeting, n),
    questionRate: rate(question, n),
    sizRate: rate(siz, n),
    senRate: rate(sen, n),
    share: rate(n, totalMessages),
  };
}

/* ------------------------------ xavfsizlik ------------------------------ */

export const STYLE_SIGNALS = ["positive", "negative", "forbidden"] as const;
export type StyleSignalKind = (typeof STYLE_SIGNALS)[number];

export interface StyleSignal {
  kind: StyleSignalKind;
  key: string;
  label: string;
  count: number;
}

/**
 * TAQIQLANGAN NAQSHLAR — bulardan o'rganilmaydi.
 *
 * Bu ro'yxat auditda KO'RILGAN xatolardan tuzilgan, taxminan
 * emas: qo'pol javob, tashqi ko'rinishga baho, "..." bilan
 * javob o'rniga jim qolish, katta harfli shoshirish.
 */
const FORBIDDEN_PATTERNS: ReadonlyArray<{ key: string; label: string; test: RegExp }> = [
  { key: "fake_urgency", label: "Soxta shoshilinchlik", test: /\bfaqat\s+bugun\b|\bshoshiling\b|\boxirgi\s+imkoniyat\b/i },
  { key: "appearance_judgment", label: "Tashqi ko‘rinishga baho", test: /\bxunuk\b|\bchiroyli\s+emas\b|\byomon\s+chiqibsiz\b/i },
  { key: "rudeness", label: "Qo‘pollik", test: /\btushunmayapsizmi\b|\bnima\s+deyapman\b|\bo['’ʻ]?qimaysizmi\b/i },
  { key: "guilt", label: "Aybdorlik hissi", test: /\bvaqtimni\s+oldingiz\b|\bbekorga\s+ishladik\b/i },
  { key: "guarantee", label: "Kafolat da’vosi", test: /\bkafolatlayman\b|\b100%\s+chiqadi\b|\balbatta\s+grant\b/i },
];

const NEGATIVE_PATTERNS: ReadonlyArray<{ key: string; label: string; test: (text: string) => boolean }> = [
  { key: "uppercase_pressure", label: "Katta harfli bosim", test: isUppercasePressure },
  { key: "ellipsis_answer", label: "“...” bilan javob", test: (text) => /^[.…\s]+$/.test(text.trim()) },
  { key: "empty_ack", label: "Mazmunsiz tasdiq", test: (text) => /^(ok|xo['’ʻ]?p|ha)[.!\s]*$/i.test(text.trim()) },
];

const POSITIVE_PATTERNS: ReadonlyArray<{ key: string; label: string; test: (text: string) => boolean }> = [
  { key: "concise", label: "Qisqa va aniq", test: (text) => text.trim().length > 0 && text.trim().length <= 160 },
  { key: "clear_next_step", label: "Aniq keyingi qadam", test: (text) => CTA_PATTERNS.some((p) => p.test(normalizeForMatch(text))) },
  { key: "polite_siz", label: "“Siz” murojaati", test: (text) => /\bsiz\b|\bsizga\b/i.test(normalizeForMatch(text)) },
  { key: "willing_help", label: "Yordamga tayyorlik", test: (text) => /\byordam\b|\bko['’ʻ]?maklash/i.test(normalizeForMatch(text)) },
];

export function collectStyleSignals(texts: readonly string[]): StyleSignal[] {
  const counts = new Map<string, StyleSignal>();
  const bump = (kind: StyleSignalKind, key: string, label: string) => {
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { kind, key, label, count: 1 });
  };

  for (const text of texts) {
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.test.test(text)) bump("forbidden", rule.key, rule.label);
    }
    for (const rule of NEGATIVE_PATTERNS) {
      if (rule.test(text)) bump("negative", rule.key, rule.label);
    }
    for (const rule of POSITIVE_PATTERNS) {
      if (rule.test(text)) bump("positive", rule.key, rule.label);
    }
  }

  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/**
 * Shu xabar TAVSIYA NAMUNASI bo'la oladimi.
 *
 * Taqiqlangan yoki salbiy belgi bo'lsa — yo'q. Bu "o'rganmaymiz"
 * degani emas (statistikada u bor), "misol qilib ko'rsatmaymiz"
 * degani.
 */
export function isRecommendableExample(text: string): boolean {
  if (FORBIDDEN_PATTERNS.some((rule) => rule.test.test(text))) return false;
  if (NEGATIVE_PATTERNS.some((rule) => rule.test(text))) return false;
  return text.trim().length > 0;
}

/* ------------------------------ to'liq tahlil --------------------------- */

export interface StyleDatasetAnalysis {
  totalCandidates: number;
  humanMessageCount: number;
  excluded: Record<ExclusionKey, number>;
  excludedTotal: number;
  conversationCount: number;
  datasetStartAt: string | null;
  datasetEndAt: string | null;
  overall: LengthDistribution;
  classes: ClassMetrics[];
  signals: StyleSignal[];
  /** Tavsiya qilish mumkin bo'lgan, redaksiyalangan namunalar. */
  recommendedExamples: string[];
}

const MAX_EXAMPLES_PER_CLASS = 3;

export function analyzeStyleDataset(
  candidates: readonly StyleCandidate[],
): StyleDatasetAnalysis {
  const selection = selectHumanDataset(candidates);
  const texts = selection.kept.map((candidate) => (candidate.text ?? "").trim());

  const byClass = new Map<MessageClass, string[]>();
  for (const text of texts) {
    const messageClass = classifyMessage(text);
    const list = byClass.get(messageClass) ?? [];
    list.push(text);
    byClass.set(messageClass, list);
  }

  const classes: ClassMetrics[] = [];
  for (const messageClass of MESSAGE_CLASSES) {
    const list = byClass.get(messageClass);
    if (!list || list.length === 0) continue;
    classes.push(metricsForClass(messageClass, list, texts.length));
  }

  const examples: string[] = [];
  for (const [, list] of byClass) {
    let taken = 0;
    for (const text of list) {
      if (taken >= MAX_EXAMPLES_PER_CLASS) break;
      if (!isRecommendableExample(text)) continue;
      examples.push(text.slice(0, 300));
      taken += 1;
    }
  }

  const dates = selection.kept.map((candidate) => candidate.sentAt).filter(Boolean).sort();

  return {
    totalCandidates: candidates.length,
    humanMessageCount: selection.kept.length,
    excluded: selection.excluded,
    excludedTotal: selection.excludedTotal,
    conversationCount: new Set(selection.kept.map((c) => c.conversationId)).size,
    datasetStartAt: dates[0] ?? null,
    datasetEndAt: dates[dates.length - 1] ?? null,
    overall: describeLengths(texts.map((text) => text.length)),
    classes: classes.sort((a, b) => b.chars.n - a.chars.n),
    signals: collectStyleSignals(texts),
    recommendedExamples: examples,
  };
}

/* ------------------------------ profil farqi ---------------------------- */

export interface ProfileDiffRow {
  field: string;
  previous: number | null;
  next: number;
  delta: number | null;
}

/** Ikki profil orasidagi farq — admin "nima o'zgardi" ni ko'rishi uchun. */
export function diffDistributions(
  previous: LengthDistribution | null,
  next: LengthDistribution,
): ProfileDiffRow[] {
  const fields: Array<keyof LengthDistribution> = ["n", "p25", "median", "p75", "p90", "mean"];
  return fields.map((field) => ({
    field,
    previous: previous ? previous[field] : null,
    next: next[field],
    delta: previous ? next[field] - previous[field] : null,
  }));
}
