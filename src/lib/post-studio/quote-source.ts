import type { PostQuoteSource } from "./types.ts";

/**
 * Quote selection — pure, so the priority order is unit-tested rather than
 * buried in a query.
 *
 * The AI never writes a quote for a post. The only automatic source is the
 * intake question carrying canonical_key=post_quote. `manual` remains an admin
 * escape hatch when that answer is blank; legacy source types are retained in
 * the type/schema only so existing rows stay readable.
 */

export interface QuoteCandidate {
  text: string;
  source: PostQuoteSource;
  /** Stable id when the quote came from the quotes table. */
  id?: string | null;
}

const PRIORITY: PostQuoteSource[] = [
  "intake_quote",
  "manual",
  "featured_quote",
  "article_quote",
  "life_motto",
  "none",
];

/**
 * `articles.excerpt` is not reliably a quote. In production 10 of 11 published
 * articles carry the short-bio badge row there ("Marketing mutaxassisi | SMM
 * mutaxassisi | Targetolog | ..."), which would have been promoted straight
 * into the poster as the headline quote. A pipe is the badge separator
 * (SHORT_BIO_SEPARATOR) and effectively never appears in real prose, so it is
 * a precise signal that the text is a list, not a quotation.
 */
export function looksLikeBadgeRow(text: string): boolean {
  return text.includes("|");
}

function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/^["“«]|["”»]$/g, "").trim();
}

/** Drops blanks and duplicates, then sorts by the fixed source priority. */
export function rankQuoteCandidates(candidates: QuoteCandidate[]): QuoteCandidate[] {
  const seen = new Set<string>();
  const cleaned: QuoteCandidate[] = [];

  for (const candidate of candidates) {
    const text = tidy(candidate.text ?? "");
    if (!text) continue;
    // Never let a badge row masquerade as a quote; an empty result becomes
    // quote_missing -> needs_review, which is the correct outcome.
    if (looksLikeBadgeRow(text)) continue;
    const key = text.toLocaleLowerCase("uz");
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ ...candidate, text });
  }

  return cleaned.sort((a, b) => PRIORITY.indexOf(a.source) - PRIORITY.indexOf(b.source));
}

/** The quote a freshly created post should start with, or null if there is none. */
export function pickQuote(candidates: QuoteCandidate[]): QuoteCandidate | null {
  return rankQuoteCandidates(candidates).find((candidate) => candidate.source === "intake_quote") ?? null;
}
