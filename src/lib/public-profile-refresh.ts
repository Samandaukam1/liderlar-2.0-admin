import "server-only";
import { after } from "next/server";
import { getSiteUrl } from "@/lib/site-url";
import { PROFILE_REVALIDATE_PATH, profileRefreshBatches } from "@/lib/public-profile-refresh-rules";

const TIMEOUT_MS = 3000;

/**
 * Tells liderlar-web that these candidates' public profiles changed.
 *
 * The public site caches each profile (one hour at most). Edits to the
 * `candidates` row itself refresh it automatically, because `updated_at` is
 * part of the cache key; edits to the related tables — sections,
 * achievements, media, certificates, articles, social links, AdabiyotX
 * books — do not touch that row, so the code that makes them calls this.
 *
 * Never throws and never delays the caller: the request goes out after the
 * response via `after()`. If it is lost, the profile still refreshes when its
 * cache expires. Authorised with the server-to-server key both projects
 * already share for the public content API.
 */
export function refreshPublicProfiles(candidateIds: ReadonlyArray<string | null | undefined>): void {
  const batches = profileRefreshBatches(candidateIds);
  if (batches.length === 0) return;
  const send = () => Promise.all(batches.map(postBatch)).then(() => undefined);
  try {
    after(send);
  } catch {
    // Outside a request scope (a script, a test): send now, without waiting.
    void send();
  }
}

async function postBatch(candidateIds: string[]): Promise<void> {
  const key = process.env.LIDERLAR_PUBLIC_CONTENT_API_KEY?.trim();
  if (!key) return;
  try {
    const response = await fetch(`${getSiteUrl()}${PROFILE_REVALIDATE_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-liderlar-api-key": key },
      body: JSON.stringify({ candidateIds }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) console.error("[profile-cache] web refused refresh:", response.status);
  } catch (error) {
    console.error("[profile-cache] refresh not sent:", error instanceof Error ? error.message : String(error));
  }
}
