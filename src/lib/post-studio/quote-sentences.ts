/**
 * Turning the candidate's raw 15th-answer into the line the poster prints.
 *
 * The answer is prose — often four or five sentences of advice — and the raw
 * text stays in the database untouched. What the poster needs is one complete
 * thought, so this picks the first sentence, or the first two when one alone
 * would leave the quote box half empty.
 *
 * Two rules are absolute: the poster never shows a fragment of a sentence, and
 * it never shows an ellipsis. Shrinking the type or taking one sentence instead
 * of two is always preferred to cutting a candidate off mid-thought.
 */

/** Characters that can end a sentence, plus the closers that may follow one. */
const TERMINATORS = ".!?…";
const CLOSERS = "\"'”»’)]";

/**
 * A dot after a very short token is an abbreviation or an initial ("h.k.",
 * "A."), not a sentence end. Two letters is the widest such token in Uzbek
 * usage and is short enough that no real word is caught by it.
 */
const MAX_ABBREVIATION_LETTERS = 2;

/**
 * Uzbek writes o‘, g‘ and the glottal ’ inside ordinary words, so the
 * apostrophes count as word characters here. Without them "ma’no?" measures as
 * the two-letter token "no" and every sentence ending in one would be mistaken
 * for an abbreviation and never split.
 */
const WORD = "\\p{L}\u2018\u2019\u02bb\u02bc'";

function endsWithAbbreviation(text: string): boolean {
  const match = text.match(new RegExp(`([${WORD}]+)[.!?…]+["\u201d\u00bb)\\]]*$`, "u"));
  return match ? match[1].replace(/[^\p{L}]/gu, "").length <= MAX_ABBREVIATION_LETTERS : false;
}

/** A new sentence starts with a capital, a digit or an opening quotation. */
function startsSentence(rest: string): boolean {
  return /^["'“«(\[]*[\p{Lu}\p{Nd}]/u.test(rest);
}

/**
 * Splits prose into sentences, keeping each sentence's own punctuation.
 * Whitespace is normalised; nothing else about the text is altered.
 */
export function splitSentences(raw: string): string[] {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return [];

  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    if (!TERMINATORS.includes(text[i])) continue;

    // Absorb runs like "!!!" and any closing quote or bracket after them.
    let end = i;
    while (end + 1 < text.length && TERMINATORS.includes(text[end + 1])) end += 1;
    while (end + 1 < text.length && CLOSERS.includes(text[end + 1])) end += 1;

    const after = text.slice(end + 1);
    if (!after.startsWith(" ")) {
      i = end;
      continue;
    }

    const candidate = text.slice(start, end + 1).trim();
    const rest = after.trimStart();
    if (!candidate || endsWithAbbreviation(candidate) || !startsSentence(rest)) {
      i = end;
      continue;
    }

    sentences.push(candidate);
    start = end + 1 + (after.length - rest.length);
    i = start - 1;
  }

  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);

  return sentences;
}

export interface QuoteFitProbe {
  /** Largest font size the text fits at, from the real layout engine. */
  fontSize: number;
  /** Laid-out height in the same units as the quote box. */
  height: number;
  /** True when even the minimum size could not contain it. */
  overflow: boolean;
}

export interface DisplayQuoteChoice {
  /** The text the poster prints — always whole sentences. */
  text: string;
  /** How many sentences it uses. */
  sentenceCount: number;
  /** Sentences the raw answer contained. */
  availableSentences: number;
  /** Why this choice was made, for the studio log. */
  reason: "single" | "only-sentence" | "extended" | "extension-too-small" | "raw";
}

export interface DisplayQuoteOptions {
  /** Measures a candidate with the real font metrics and the real box. */
  probe: (text: string) => QuoteFitProbe;
  /** Height of the quote box, to judge how full one sentence leaves it. */
  boxHeight: number;
  /** Below this fill ratio a second sentence is worth trying. */
  minFillRatio: number;
  /** A second sentence is only taken if it still sets at least this large. */
  comfortFontSize: number;
}

/**
 * Chooses the display quote.
 *
 * The decision is made with real text measurement, not a character count: the
 * same engine that lays the quote out reports what each candidate would
 * actually render at, so "does one sentence look lost in the box" is answered
 * by geometry rather than by a guess about average word length.
 */
export function selectDisplayQuote(
  raw: string,
  options: DisplayQuoteOptions,
): DisplayQuoteChoice {
  const sentences = splitSentences(raw);
  if (sentences.length === 0) {
    return { text: "", sentenceCount: 0, availableSentences: 0, reason: "raw" };
  }

  const first = sentences[0];
  if (sentences.length === 1) {
    return { text: first, sentenceCount: 1, availableSentences: 1, reason: "only-sentence" };
  }

  const firstFit = options.probe(first);
  const fill = options.boxHeight > 0 ? firstFit.height / options.boxHeight : 1;
  if (!firstFit.overflow && fill >= options.minFillRatio) {
    return { text: first, sentenceCount: 1, availableSentences: sentences.length, reason: "single" };
  }

  const extended = `${first} ${sentences[1]}`;
  const extendedFit = options.probe(extended);
  if (!extendedFit.overflow && extendedFit.fontSize >= options.comfortFontSize) {
    return {
      text: extended,
      sentenceCount: 2,
      availableSentences: sentences.length,
      reason: "extended",
    };
  }

  return {
    text: first,
    sentenceCount: 1,
    availableSentences: sentences.length,
    reason: "extension-too-small",
  };
}
