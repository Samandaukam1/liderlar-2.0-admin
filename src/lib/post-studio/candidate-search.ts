/**
 * Turns what an admin types into the post picker into `ilike` patterns, one
 * per word, so "Madina Avaz" finds "Madina Isomova Avaz qizi" — every word
 * must appear, in any order.
 *
 * Names are stored with whichever apostrophe the candidate typed (', ‘, ’, ʻ),
 * and an admin types whichever their keyboard gives them. Each apostrophe
 * becomes `_`, the single-character wildcard, so "G'ulom" matches "Gʻulom".
 * The pattern's own wildcards are stripped from the input so a stray `%` can
 * not widen the search to everyone.
 */

const MAX_WORDS = 5;

export function candidateSearchPatterns(query: string): string[] {
  return query
    .replace(/[%_*\\]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/[ʻʼ‘’`´']/g, "_"))
    .filter((word) => word.replace(/_/g, "").length > 0)
    .slice(0, MAX_WORDS)
    .map((word) => `%${word}%`);
}
