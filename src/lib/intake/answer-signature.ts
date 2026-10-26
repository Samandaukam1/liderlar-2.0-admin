/**
 * "Has this answer actually changed?" — shared by the intake form (skip a
 * request) and the autosave service (skip the write and the revision row).
 *
 * Pure: no browser, React or server-only dependency, so the form, the server
 * and the regression tests all import it directly.
 *
 * Why it exists: autosave wrote a full revision snapshot on every request, and
 * 18% of the snapshots sampled on 2026-10-26 were byte-identical to the one
 * before (the editor reports a change on focus/normalisation, a blur flushes,
 * a second tab re-sends). The table holds ~980,000 rows (639 MB of a 1 GB
 * database).
 */

/**
 * JSON with object keys sorted at every level. Postgres `jsonb` returns keys in
 * its own order, the editor in insertion order — the same document must
 * compare equal either way. Array order is meaningful and kept.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? "null";
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) out[key] = sortKeys(child);
    }
    return out;
  }
  return value;
}

export interface AnswerContent {
  answerState: string;
  plainText: string;
  richContent: unknown;
}

/** Equal signatures mean the stored answer would not change. */
export function answerSignature(answer: AnswerContent): string {
  return stableJson([answer.answerState, answer.plainText, answer.richContent ?? {}]);
}
