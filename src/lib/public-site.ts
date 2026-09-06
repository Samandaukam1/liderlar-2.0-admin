/**
 * The public site's address — written down exactly once, for the whole admin.
 *
 * Every user-facing link (candidate profile, article, certificate QR, Telegram
 * caption and buttons, share links, monthly-update links) resolves through this
 * module. Nothing else in the codebase may spell a public domain out by hand:
 * a Vercel preview or deployment URL leaking into a link that thousands of
 * subscribers receive is exactly the failure this centralisation prevents.
 *
 * Resolution order, everywhere:
 *   1. site_settings → `public_web.base_url`  (changeable without a deploy)
 *   2. NEXT_PUBLIC_PUBLIC_WEB_URL / NEXT_PUBLIC_SITE_URL  (per-environment)
 *   3. CANONICAL_PUBLIC_SITE_URL              (production truth)
 *
 * Step 3 used to be deliberately absent, because liderlar.uz still served the
 * OLD (1.0) site and a caption linking there sent readers to the wrong page.
 * Liderlar 2.0 now owns the domain, so the canonical fallback is correct and a
 * missing setting no longer blocks a post.
 *
 * Pure on purpose (no `server-only`, no DB): the async, settings-aware resolver
 * lives in post-studio/site-origin.ts and layers on top of this.
 */

/** Production canonical public origin. The single place this domain appears. */
export const CANONICAL_PUBLIC_SITE_URL = "https://liderlar.uz";

/** site_settings key holding an override for the origin above. */
export const PUBLIC_WEB_SETTING_KEY = "public_web.base_url";

/** Normalizes a configured origin; returns null for anything unusable. */
export function normalizePublicWebUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  // A localhost value in production config is a misconfiguration, not an origin.
  if (/localhost|127\.0\.0\.1/i.test(value)) return null;

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Origin of an article URL an admin confirmed by hand.
 *
 * Pasting a link from the public site is itself a statement of where that site
 * lives, so it stands in for `public_web.base_url` when the setting is empty.
 */
export function originOfConfirmedUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (/localhost|127\.0\.0\.1/i.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Candidate profile/article path on the public site: /liderlar/<slug>. */
export function candidateArticlePath(slug: string): string {
  return `/liderlar/${slug.trim()}`;
}

/**
 * True for a Vercel deployment host (`*.vercel.app`).
 *
 * These are infrastructure addresses: they change per deployment, are not the
 * site's public identity, and must never end up in a certificate QR code, a
 * Telegram caption, a share link or a candidate's profile URL.
 */
export function isVercelDeploymentUrl(raw: string | null | undefined): boolean {
  const value = (raw ?? "").trim();
  if (!value) return false;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return /\.vercel\.app$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * An env-provided public origin, or null when the value cannot serve as one.
 *
 * Stricter than normalizePublicWebUrl on purpose: an admin who types a preview
 * origin into `public_web.base_url` means it, but a `*.vercel.app` value in an
 * environment variable is the platform's own address leaking into config.
 */
export function normalizeEnvPublicUrl(raw: string | null | undefined): string | null {
  const normalized = normalizePublicWebUrl(raw);
  if (!normalized) return null;
  if (isVercelDeploymentUrl(normalized)) return null;
  // The public site is https-only; an `http://` value in a Vercel env var
  // really happened here, and a plain-http share link is a downgrade nobody
  // asked for. localhost is already excluded above, so this cannot break dev.
  return normalized.replace(/^http:\/\//i, "https://");
}

/**
 * Public origin from the environment alone — the synchronous half.
 *
 * Self-heals the formatting mistakes that really happened in this project's
 * Vercel env vars (missing protocol, http, trailing slash, a localhost value
 * left over from a dev config, the deployment URL itself) instead of throwing
 * on them, because the canonical domain is always a correct answer.
 */
export function publicSiteUrlFromEnv(raw: string | null | undefined): string {
  return normalizeEnvPublicUrl(raw) ?? CANONICAL_PUBLIC_SITE_URL;
}
