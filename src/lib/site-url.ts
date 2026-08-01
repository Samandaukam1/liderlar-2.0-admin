import "server-only";

const PRODUCTION_FALLBACK = "https://liderlar.uz";

/**
 * Resolves the production public-site origin (liderlar-web) for building
 * certificate/QR links. Self-heals common env-var formatting mistakes
 * (missing protocol, http instead of https, trailing slash, or the value
 * pointing at localhost — which really happened in this project's Vercel
 * production env vars) instead of throwing on them. A throw here previously
 * propagated up through resolveCertificateTargetUrl's error handling and
 * either looked identical to "candidate isn't published yet" or, once that
 * was fixed, surfaced as a raw, user-facing environment error — neither of
 * which should block a feature when a perfectly good fallback exists.
 */
export function getSiteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? PRODUCTION_FALLBACK).trim();

  const base = /localhost|127\.0\.0\.1/i.test(raw) ? PRODUCTION_FALLBACK : raw;
  const withProtocol = /^https?:\/\//i.test(base) ? base : `https://${base}`;
  const httpsUrl = withProtocol.replace(/^http:\/\//i, "https://");
  return httpsUrl.replace(/\/+$/, "");
}
