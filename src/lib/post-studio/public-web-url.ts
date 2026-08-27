/**
 * Public-site origin handling — pure half, so the "never guess a domain" rule
 * is covered by real unit tests.
 *
 * Deliberately separate from lib/site-url.ts's getSiteUrl(): that one falls
 * back to https://liderlar.uz, which currently still points at the OLD site. A
 * caption linking there would send every subscriber to the wrong page, so
 * there is no fallback here at all.
 */

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

/** Candidate article path on the public site. */
export function candidateArticlePath(slug: string): string {
  return `/liderlar/${slug.trim()}`;
}
