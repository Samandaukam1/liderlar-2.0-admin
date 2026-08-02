/**
 * Fact preservation — pure, no DB, no server-only, unit-tested.
 *
 * "Barcha javoblarni yaxshilash" is an editing pass, not a summarizer: every
 * date, number, organization, award and quotation the candidate wrote must
 * survive into the improved text. This module extracts those anchors from the
 * original answer and reports which ones the model dropped, so the caller can
 * re-prompt with the missing list instead of silently saving a shorter answer.
 */

export type FactKind = "number" | "quote" | "proper_noun";

export interface DetectedFact {
  kind: FactKind;
  /** Human-readable form, shown to the admin and fed back to the model. */
  value: string;
  /** Normalized key used for the presence check. */
  key: string;
}

/**
 * Uzbek Latin uses several apostrophe glyphs interchangeably (oʻ, o‘, o'), and
 * candidates paste text from sources that disagree. Comparing raw characters
 * would report a fact as lost purely because the model normalized a glyph.
 */
function unifyApostrophes(value: string): string {
  return value.replace(/[ʻʼ‘’`´']/g, "'");
}

function unifyQuotes(value: string): string {
  return value.replace(/[“”«»„‟]/g, '"');
}

export function normalizeForCompare(value: string): string {
  return unifyQuotes(unifyApostrophes(value))
    .toLocaleLowerCase("uz")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Uzbek is agglutinative, so the same proper noun appears as "Farg'ona",
 * "Farg'onada", "Farg'onaning". Comparing inflected surface forms would flag a
 * fact as dropped whenever the editor changed the case ending, so both sides
 * are reduced to a stem before matching.
 */
const CASE_SUFFIXES = [
  "larimizning", "laringizning", "larining", "laridagi", "laridan", "larimiz",
  "laringiz", "lariga", "larini", "larning", "lardagi", "lardan", "larga",
  "larni", "lari", "lar",
  "imizning", "ingizning", "ningki", "nikida", "gacha", "dagi", "ning", "niki",
  "imiz", "ingiz", "dan", "day", "dek", "cha", "ga", "da", "ni", "ku",
  "si", "im", "ing", "i",
];

const MIN_STEM_LENGTH = 4;
const MAX_STEM_ROUNDS = 3;

// Longest first, so "larida" is never shortened to "larid" by matching "a".
const ORDERED_SUFFIXES = [...CASE_SUFFIXES].sort((a, b) => b.length - a.length);

export function stemWord(word: string): string {
  let stem = normalizeForCompare(word).replace(/[.,;:!?()"]/g, "");
  // Stacked suffixes ("universitet-i-da") need repeated passes, and stemming
  // must be idempotent: stem("universitetida") has to equal
  // stem("universiteti"), or the same institution reads as two facts.
  for (let round = 0; round < MAX_STEM_ROUNDS; round += 1) {
    const suffix = ORDERED_SUFFIXES.find(
      (candidate) => stem.length - candidate.length >= MIN_STEM_LENGTH && stem.endsWith(candidate),
    );
    if (!suffix) break;
    stem = stem.slice(0, -suffix.length);
  }
  return stem;
}

/**
 * Capitalized words that merely start a sentence are not proper nouns. Treating
 * them as facts would trigger endless re-prompts for pronouns the editor is
 * explicitly told to rewrite ("Men" -> "U").
 */
const CAPITALIZED_NON_NOUNS = new Set(
  [
    "men", "u", "bu", "shu", "ular", "biz", "siz", "mening", "uning", "bizning",
    "sizning", "ushbu", "har", "barcha", "hozir", "hozirda", "hozirgi", "bugun",
    "bugungi", "keyin", "keyinchalik", "ammo", "lekin", "biroq", "chunki",
    "shuningdek", "shu bois", "ayni", "ana", "mana", "yana", "eng", "juda",
    "shundan", "shunda", "shundan so'ng", "so'ng", "avval", "avvalo", "dastlab",
    "bundan", "buning", "unda", "unga", "menga", "meni", "mening", "o'z",
    "o'zim", "o'zining", "hech", "hamda", "va", "yoki", "agar", "qachonki",
  ].map(normalizeForCompare),
);

/** Words that mark the preceding capitalized run as an institution/award. */
const INSTITUTION_HINTS = new Set(
  [
    "universitet", "universiteti", "institut", "instituti", "texnikum",
    "texnikumi", "kolleji", "kollej", "akademiya", "akademiyasi", "maktab",
    "maktabi", "litsey", "litseyi", "fakulteti", "fakultet", "markazi",
    "markaz", "festival", "festivali", "tanlov", "tanlovi", "forum", "forumi",
    "konferensiya", "konferensiyasi", "mukofoti", "mukofot", "nishoni",
    "medali", "korxona", "korxonasi", "kompaniya", "kompaniyasi", "tashkilot",
    "tashkiloti", "vazirligi", "viloyati", "tumani", "shahri", "mahallasi",
  ].map(normalizeForCompare),
);

function isCapitalized(word: string): boolean {
  const first = unifyApostrophes(word).replace(/^[("'«]+/, "").charAt(0);
  return !!first && first === first.toLocaleUpperCase("uz") && first !== first.toLocaleLowerCase("uz");
}

function pushUnique(facts: DetectedFact[], fact: DetectedFact): void {
  if (!fact.key) return;
  if (facts.some((existing) => existing.kind === fact.kind && existing.key === fact.key)) return;
  facts.push(fact);
}

/**
 * Extracts the anchors that must survive editing: every digit run (years,
 * counts, percentages), every quoted phrase, and every proper noun.
 */
export function extractFacts(text: string): DetectedFact[] {
  const facts: DetectedFact[] = [];
  if (!text?.trim()) return facts;

  const source = unifyQuotes(unifyApostrophes(text));

  // ---- numbers: 2024, 18, 23, 45%, 3,5 ----
  for (const match of source.matchAll(/\d+(?:[.,]\d+)*\s*%?/g)) {
    const value = match[0].trim();
    // A digit run is compared on digits alone: "2024-yilda" and "2024-yil"
    // carry the same fact, and the editor is allowed to change the suffix.
    const digits = value.replace(/[^\d]/g, "");
    if (!digits) continue;
    pushUnique(facts, { kind: "number", value, key: digits });
  }

  // ---- quotations: the candidate's own words, kept verbatim ----
  for (const match of source.matchAll(/"([^"\n]{2,200})"/g)) {
    const inner = match[1].trim();
    if (!inner) continue;
    pushUnique(facts, { kind: "quote", value: inner, key: normalizeForCompare(inner) });
  }

  // ---- proper nouns: capitalized runs, plus institution phrases ----
  const words = source.split(/\s+/);
  let run: string[] = [];
  const flushRun = (endIndex: number) => {
    if (run.length === 0) return;
    const phrase = run.join(" ").replace(/[.,;:!?]+$/, "");
    const stems = run.map(stemWord).filter(Boolean);
    const isSentenceStart = endIndex - run.length === 0 || /[.!?]$/.test(words[endIndex - run.length - 1] ?? "");
    const nextWord = normalizeForCompare(words[endIndex] ?? "").replace(/[.,;:!?]/g, "");
    const looksInstitutional = INSTITUTION_HINTS.has(nextWord);

    // A lone capitalized word that opens a sentence is only kept when the word
    // after it names an institution ("Farg'ona viloyati"), otherwise it is
    // almost always an ordinary sentence-initial word.
    const meaningful = run.length > 1 || looksInstitutional || !isSentenceStart;
    if (meaningful && stems.length > 0) {
      pushUnique(facts, {
        kind: "proper_noun",
        value: looksInstitutional ? `${phrase} ${words[endIndex] ?? ""}`.trim() : phrase,
        key: stems.join(" "),
      });
    }
    run = [];
  };

  words.forEach((word, index) => {
    const bare = word.replace(/^[("'«]+/, "");
    const normalized = normalizeForCompare(bare).replace(/[.,;:!?]/g, "");
    if (isCapitalized(bare) && normalized && !CAPITALIZED_NON_NOUNS.has(normalized) && !/^\d/.test(normalized)) {
      run.push(bare.replace(/[.,;:!?]+$/, ""));
      if (/[.!?]$/.test(word)) flushRun(index + 1);
      return;
    }
    flushRun(index);
  });
  flushRun(words.length);

  return facts;
}

/** True when the improved text still carries the fact. */
export function textContainsFact(text: string, fact: DetectedFact): boolean {
  if (fact.kind === "number") {
    const digits = unifyApostrophes(text).match(/\d+(?:[.,]\d+)*/g) ?? [];
    return digits.some((run) => run.replace(/[^\d]/g, "") === fact.key);
  }

  const normalized = normalizeForCompare(text);
  if (fact.kind === "quote") {
    return normalized.includes(fact.key);
  }

  // Proper nouns are compared stem-by-stem so a changed case ending or a
  // reordered phrase still counts as preserved.
  const haystack = new Set(normalized.split(/\s+/).map(stemWord).filter(Boolean));
  return fact.key.split(" ").every((stem) => haystack.has(stem));
}

export interface FactPreservationReport {
  detected: DetectedFact[];
  missing: DetectedFact[];
  preservedCount: number;
  ok: boolean;
}

/**
 * Compares an improved answer against its original. `ok` is false whenever any
 * anchor disappeared — the caller re-prompts rather than saving the loss.
 */
export function checkFactPreservation(original: string, improved: string): FactPreservationReport {
  const detected = extractFacts(original);
  const missing = detected.filter((fact) => !textContainsFact(improved, fact));
  return {
    detected,
    missing,
    preservedCount: detected.length - missing.length,
    ok: missing.length === 0,
  };
}

/** The "Yo‘qolgan faktlar" block appended to the retry prompt. */
export function formatMissingFactsPrompt(missing: DetectedFact[]): string {
  if (missing.length === 0) return "";
  return [
    "QUYIDAGI MA'LUMOTLAR YAXSHILANGAN MATNDA YO'QOLGAN.",
    "Ularning HAMMASINI qayta yozilgan matnga qaytar. Hech birini umumiy gapga almashtirma:",
    ...missing.map((fact) => `- ${fact.value}`),
  ].join("\n");
}
