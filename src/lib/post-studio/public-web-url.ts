/**
 * Public-site origin handling for Post Studio.
 *
 * The rules themselves now live in lib/public-site.ts, which is the single
 * source of truth for the public domain across the whole admin. This module
 * stays as the Post Studio entry point so every existing importer (and its
 * tests) keeps one stable path.
 */

export {
  CANONICAL_PUBLIC_SITE_URL,
  PUBLIC_WEB_SETTING_KEY,
  candidateArticlePath,
  normalizePublicWebUrl,
  originOfConfirmedUrl,
} from "../public-site.ts";
