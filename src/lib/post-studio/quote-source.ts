import type { PostQuoteSource } from "./types.ts";

/**
 * Quote selection — pure, so the priority order is unit-tested rather than
 * buried in a query.
 *
 * The AI never writes a quote for a post: every candidate quote must already
 * exist as approved content. The order is fixed by the brief:
 *   featured quote -> quote approved inside the article -> life motto -> manual.
 */

export interface QuoteCandidate {
  text: string;
  source: PostQuoteSource;
  /** Stable id when the quote came from the quotes table. */
  id?: string | null;
}

const PRIORITY: PostQuoteSource[] = ["featured_quote", "article_quote", "life_motto", "manual"];

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
    const key = text.toLocaleLowerCase("uz");
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ ...candidate, text });
  }

  return cleaned.sort((a, b) => PRIORITY.indexOf(a.source) - PRIORITY.indexOf(b.source));
}

/** The quote a freshly created post should start with, or null if there is none. */
export function pickQuote(candidates: QuoteCandidate[]): QuoteCandidate | null {
  return rankQuoteCandidates(candidates)[0] ?? null;
}
