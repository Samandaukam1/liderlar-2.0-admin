/**
 * Stable identity and editorial rules for the one intake answer that is allowed
 * to become a Post Studio quote.
 *
 * `question_no` remains a legacy fallback only. New and backfilled templates
 * are identified by `canonical_key`, so reordered/extended questionnaires do
 * not silently point Post Studio at another answer.
 */

export const CANONICAL_POST_QUOTE_KEY = "post_quote";

export const CANONICAL_POST_QUOTE_PROMPT =
  "Boshqa yoshlar uchun qanday maslahat yoki motivatsion fikr bildirasiz?";

/**
 * The candidate's own words go onto the poster untouched — Jaxongir AI is
 * blocked from rewriting this one answer — so the instruction has to carry
 * every constraint the poster depends on: length, spelling, and the fact that
 * nobody will tidy it afterwards.
 */
export const CANONICAL_POST_QUOTE_HELP_TEXT =
  "Ikkita gap yozing. Har bir gap kamida 6 ta so‘zdan iborat bo‘lsin va imloviy " +
  "xatolarsiz bo‘lsin. Iltimos, avval matnni ChatGPT orqali tekshirib, " +
  "moslashtirilgan variantini shu yerga joylashtiring — iqtibosingiz qanday " +
  "yozilgan bo‘lsa, postga shundayligicha olinadi va o‘zgartirilmaydi.";

export interface CanonicalQuestionIdentity {
  canonical_key?: string | null;
  prompt?: string | null;
  question_no?: number | null;
}

function normalizePrompt(value: string | null | undefined): string {
  return (value ?? "")
    .toLocaleLowerCase("uz")
    .replace(/[‘’'`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable key first, exact historical prompt second, number only as fallback. */
export function isCanonicalPostQuoteQuestion(question: CanonicalQuestionIdentity): boolean {
  if (question.canonical_key === CANONICAL_POST_QUOTE_KEY) return true;
  if (normalizePrompt(question.prompt) === normalizePrompt(CANONICAL_POST_QUOTE_PROMPT)) {
    return true;
  }
  return question.question_no === 15;
}

/**
 * The deterministic Jaxongir rule for the canonical quote.
 *
 * It deliberately performs no paraphrasing and no third-person conversion.
 * Trimming transport whitespace is the only change, which keeps the candidate's
 * wording and punctuation intact while preventing accidental line-break noise.
 */
export function preserveCanonicalPostQuote(original: string | null | undefined): string {
  return (original ?? "").replace(/\s+/g, " ").trim();
}
