import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { instagramProfileUrl, normalizeInstagram } from "./schemas";

/**
 * The intake's optional Instagram handle, carried onto the candidate.
 *
 * There is no separate column on `candidates`: the existing `social_links`
 * section table already models "a link on a candidate's public profile", and
 * liderlar-web already renders every row of it. Reusing it means the handle
 * shows up on the public profile with no change to the site at all.
 */

/** Row title the Instagram link is stored (and recognised) under. */
export const INSTAGRAM_LINK_TITLE = "Instagram";

/**
 * Writes — or clears — the candidate's Instagram row.
 *
 * Delete-then-insert rather than an upsert because `social_links` has no unique
 * key to conflict on. That also makes a re-promotion idempotent: promoting the
 * same intake twice leaves exactly one Instagram row, never a second copy.
 *
 * Returns the canonical handle that was stored, or null when there was none.
 */
export async function syncCandidateInstagramLink(
  candidateId: string,
  rawHandle: string | null | undefined,
): Promise<string | null> {
  const username = normalizeInstagram(rawHandle);
  const db = createSupabaseAdminClient();

  const { error: clearError } = await db
    .from("social_links")
    .delete()
    .eq("candidate_id", candidateId)
    .eq("title", INSTAGRAM_LINK_TITLE);
  if (clearError) {
    console.error("[intake] instagram link clear failed", clearError.message);
    return null;
  }

  if (!username) return null;

  const { error } = await db.from("social_links").insert({
    candidate_id: candidateId,
    title: INSTAGRAM_LINK_TITLE,
    subtitle: `@${username}`,
    url: instagramProfileUrl(username),
    sort_order: 0,
  });
  if (error) {
    // A social link is not worth failing a promotion over — the article, the
    // post and the publication are all already correct without it.
    console.error("[intake] instagram link write failed", error.message);
    return null;
  }
  return username;
}

/** The candidate's stored Instagram handle, read back from `social_links`. */
export async function getCandidateInstagramUsername(
  candidateId: string,
): Promise<string | null> {
  const db = createSupabaseAdminClient();
  const { data } = await db
    .from("social_links")
    .select("url, subtitle")
    .eq("candidate_id", candidateId)
    .eq("title", INSTAGRAM_LINK_TITLE)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return (
    normalizeInstagram(data.url as string | null) ??
    normalizeInstagram(data.subtitle as string | null)
  );
}
