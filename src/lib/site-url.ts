import "server-only";
import { publicSiteUrlFromEnv } from "@/lib/public-site";

/**
 * Resolves the production public-site origin (liderlar-web) for certificate/QR
 * links, share links and the admin's "Saytda ko'rish" button.
 *
 * Synchronous, so it stays usable from render paths that cannot await a
 * settings read; the DB-backed resolver (site_settings first) is
 * post-studio/site-origin.ts, which layers on top of the same constant. Both
 * end at CANONICAL_PUBLIC_SITE_URL — the domain is never spelled out here.
 */
export function getSiteUrl(): string {
  return publicSiteUrlFromEnv(process.env.NEXT_PUBLIC_SITE_URL);
}
