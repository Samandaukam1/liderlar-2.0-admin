/**
 * Rules for asking liderlar-web to refresh cached public profiles.
 * Pure (no I/O, no `@/` imports) so the tests can import it directly.
 */

/** liderlar-web route that expires the cache of the given candidates. */
export const PROFILE_REVALIDATE_PATH = "/api/revalidate/profile";

/** The web route accepts at most this many ids per request. */
export const PROFILE_REVALIDATE_BATCH = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valid, de-duplicated candidate ids, split into request-sized batches. */
export function profileRefreshBatches(candidateIds: ReadonlyArray<string | null | undefined>): string[][] {
  const ids = [
    ...new Set(
      candidateIds
        .filter((id): id is string => typeof id === "string" && UUID.test(id))
        .map((id) => id.toLowerCase()),
    ),
  ];
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += PROFILE_REVALIDATE_BATCH) {
    batches.push(ids.slice(i, i + PROFILE_REVALIDATE_BATCH));
  }
  return batches;
}
