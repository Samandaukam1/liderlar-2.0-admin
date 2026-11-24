/**
 * Preserve the entire quote for the poster. Sentence boundaries are only
 * diagnostic; they must never remove text. The layout engine fits the full
 * text and flags oversized quotes for review instead of silently shortening.
 */

export const POST_QUOTE_MAX_CHARACTERS = 500;

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

export interface DisplayQuoteChoice {
  /** Full text, with transport whitespace normalized only. */
  text: string;
  /** How many sentences it uses. */
  sentenceCount: number;
  /** Sentences the raw answer contained. */
  availableSentences: number;
  /** Why this choice was made, for the studio log. */
  reason: "full" | "raw";
}

/** The length limit marks review; it never slices the original text. */
export function selectDisplayQuote(raw: string): DisplayQuoteChoice {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  const count = splitSentences(text).length;
  return {
    text,
    sentenceCount: count,
    availableSentences: count,
    reason: text ? "full" : "raw",
  };
}
