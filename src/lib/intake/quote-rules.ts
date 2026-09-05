/**
 * Post iqtibosiga qo'yilgan talablar — sof modul.
 *
 * Iqtibos posterga AYNAN shu holicha chiqadi, shuning uchun qoidalar bir joyda
 * turadi va haqiqiy testlar bilan qoplanadi: modelga nima so'ralganini ham,
 * qaytgan javob qabul qilinadimi-yo'qmi ham shu yerdagi funksiyalar hal qiladi.
 */

/** Ikkita gap. */
export const QUOTE_SENTENCE_COUNT = 2;

/** Har bir gapda kamida shuncha so'z. */
export const QUOTE_MIN_WORDS_PER_SENTENCE = 6;

/**
 * Upper bound per sentence.
 *
 * Not a stated requirement, but the poster's quote box is a fixed size: a
 * grammatically valid 40-word sentence still renders as unreadable four-point
 * text, so the model is held to something that fits.
 */
export const QUOTE_MAX_WORDS_PER_SENTENCE = 18;

/**
 * Splits into sentences on terminal punctuation.
 *
 * A run of terminators counts once ("Harakat qiling!!!" is one sentence), and a
 * trailing terminator does not produce an empty final entry.
 */
export function splitSentences(text: string): string[] {
  return (text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function countWords(sentence: string): number {
  return (sentence.match(/[\p{L}\p{N}’'‘ʻ-]+/gu) ?? []).length;
}

export interface QuoteCheck {
  ok: boolean;
  sentences: string[];
  wordCounts: number[];
  /** Why it failed, in the words the model is asked to fix. */
  problems: string[];
}

/** Does this text satisfy the rule the candidate was shown? */
export function checkQuote(text: string): QuoteCheck {
  const sentences = splitSentences(text);
  const wordCounts = sentences.map(countWords);
  const problems: string[] = [];

  if (sentences.length !== QUOTE_SENTENCE_COUNT) {
    problems.push(
      `Gaplar soni ${sentences.length} — aynan ${QUOTE_SENTENCE_COUNT} ta bo‘lishi kerak.`,
    );
  }
  wordCounts.forEach((count, index) => {
    if (count < QUOTE_MIN_WORDS_PER_SENTENCE) {
      problems.push(
        `${index + 1}-gapda ${count} ta so‘z — kamida ${QUOTE_MIN_WORDS_PER_SENTENCE} ta kerak.`,
      );
    }
    if (count > QUOTE_MAX_WORDS_PER_SENTENCE) {
      problems.push(
        `${index + 1}-gapda ${count} ta so‘z — ko‘pi bilan ${QUOTE_MAX_WORDS_PER_SENTENCE} ta bo‘lsin.`,
      );
    }
  });
  // Every sentence has to end in a terminator, or the poster shows a fragment.
  if (sentences.some((s) => !/[.!?]$/.test(s))) {
    problems.push("Har bir gap nuqta, undov yoki so‘roq belgisi bilan tugasin.");
  }

  return { ok: problems.length === 0, sentences, wordCounts, problems };
}

/**
 * The form a quote is compared in when checking for repeats.
 *
 * Case, punctuation and the five Uzbek apostrophes are all dropped: two quotes
 * differing only by a comma are the same quote to a reader, and shipping both
 * would be exactly the repetition this is meant to prevent.
 */
export function quoteFingerprint(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[ʻʼ‘’'`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when the candidate left the answer empty. */
export function isBlankQuote(text: string | null | undefined): boolean {
  return quoteFingerprint(text ?? "").length === 0;
}
