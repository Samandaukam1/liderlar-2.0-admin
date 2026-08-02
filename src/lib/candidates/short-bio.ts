/**
 * Short bio ("&&&" / candidates.description_items) — pure, unit-tested.
 *
 * The short bio is a badge row, not a paragraph: a handful of role/quality
 * labels rendered next to the candidate's name. The model kept writing a full
 * sentence into it, so the limits are enforced here rather than trusted to the
 * prompt.
 */

export const SHORT_BIO_SEPARATOR = " | ";
export const SHORT_BIO_MAX_ITEMS = 5;
export const SHORT_BIO_MAX_ITEM_LENGTH = 40;
export const SHORT_BIO_MAX_WORDS = 5;

export type ShortBioRejectionReason = "too_long" | "too_many_words" | "sentence_like" | "duplicate" | "over_limit";

export interface ShortBioRejection {
  value: string;
  reason: ShortBioRejectionReason;
}

export interface ShortBioResult {
  items: string[];
  rejected: ShortBioRejection[];
  ok: boolean;
}

function unifyApostrophes(value: string): string {
  return value.replace(/[ʻʼ‘’`´']/g, "'");
}

/** Trailing sentence punctuation is stripped; a badge never ends in a period. */
function tidy(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;,!?]+$/, "")
    .trim();
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

/**
 * Sentence detection: a badge is a noun phrase. Verb endings and clause commas
 * are what turned "Filolog" into "U kelajak sari intilayotgan yosh qiz".
 */
function looksLikeSentence(value: string): boolean {
  const normalized = unifyApostrophes(value).toLocaleLowerCase("uz");
  if (/[,;]/.test(value)) return true;
  return /(gan|yotgan|moqda|adigan|ydigan|aman|yman|iman|di|ladi|edi)\b\s*\S*$/.test(normalized)
    && wordCount(value) > 2;
}

export function splitShortBioItems(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  return value.split("|");
}

/**
 * Applies every short-bio rule and reports what it dropped, so the admin sees
 * why an item disappeared instead of it vanishing silently.
 */
export function normalizeShortBioItems(input: string | string[] | null | undefined): ShortBioResult {
  const rejected: ShortBioRejection[] = [];
  const items: string[] = [];
  const seen = new Set<string>();

  for (const raw of splitShortBioItems(input)) {
    const value = tidy(String(raw));
    if (!value) continue;

    if (value.length > SHORT_BIO_MAX_ITEM_LENGTH) {
      rejected.push({ value, reason: "too_long" });
      continue;
    }
    if (wordCount(value) > SHORT_BIO_MAX_WORDS) {
      rejected.push({ value, reason: "too_many_words" });
      continue;
    }
    if (looksLikeSentence(value)) {
      rejected.push({ value, reason: "sentence_like" });
      continue;
    }

    const key = unifyApostrophes(value).toLocaleLowerCase("uz");
    if (seen.has(key)) {
      rejected.push({ value, reason: "duplicate" });
      continue;
    }
    if (items.length >= SHORT_BIO_MAX_ITEMS) {
      rejected.push({ value, reason: "over_limit" });
      continue;
    }

    seen.add(key);
    items.push(value);
  }

  return { items, rejected, ok: items.length > 0 };
}

export function joinShortBioItems(items: string[]): string {
  return items.join(SHORT_BIO_SEPARATOR);
}
