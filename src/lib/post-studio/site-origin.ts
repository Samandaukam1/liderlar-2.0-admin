import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  candidateArticlePath,
  normalizePublicWebUrl,
  PUBLIC_WEB_SETTING_KEY,
} from "./public-web-url.ts";

/**
 * Resolves the canonical public-site origin used for candidate article links.
 *
 * There is no domain fallback on purpose (see public-web-url.ts): when nothing
 * is configured this returns null and the post is held at needs_review for an
 * admin to confirm the URL, rather than linking the old liderlar.uz site.
 */

let cached: { value: string | null; at: number } | null = null;
const CACHE_MS = 60_000;

/**
 * site_settings first (an admin can change it without a deploy), then the env
 * var, then nothing. Cached briefly so a batch delivery does not re-read it
 * once per subscriber.
 */
export async function resolvePublicWebUrl(): Promise<string | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  let fromSettings: string | null = null;
  try {
    const db = createSupabaseAdminClient();
    const { data } = await db
      .from("site_settings")
      .select("value")
      .eq("key", PUBLIC_WEB_SETTING_KEY)
      .maybeSingle();
    fromSettings = (data?.value as string | null) ?? null;
  } catch {
    // A settings read failure must not silently promote the env fallback to
    // "configured"; it just leaves this source empty.
    fromSettings = null;
  }

  const value =
    normalizePublicWebUrl(fromSettings) ??
    normalizePublicWebUrl(process.env.NEXT_PUBLIC_PUBLIC_WEB_URL);

  cached = { value, at: Date.now() };
  return value;
}

/** Candidate article URL on the public site, or null when unconfigured. */
export async function buildCandidateArticleUrl(slug: string): Promise<string | null> {
  const base = await resolvePublicWebUrl();
  if (!base || !slug.trim()) return null;
  return `${base}${candidateArticlePath(slug)}`;
}
