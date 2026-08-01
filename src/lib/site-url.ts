import "server-only";

/**
 * Resolves the production public-site origin (liderlar-web) for building
 * certificate/QR links. Self-heals common env-var formatting mistakes
 * (missing protocol, http instead of https, trailing slash) instead of
 * throwing on them — a throw here previously propagated up through
 * resolveCertificateTargetUrl's error handling and silently looked
 * identical to "candidate isn't published yet", which made a bad
 * NEXT_PUBLIC_SITE_URL value undiagnosable from the UI. The one thing this
 * still refuses is localhost, since that's never a link worth baking into a
 * downloadable certificate.
 */
export function getSiteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://liderlar.uz").trim();

  if (/localhost|127\.0\.0\.1/i.test(raw)) {
    throw new Error("NEXT_PUBLIC_SITE_URL points at localhost.");
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const httpsUrl = withProtocol.replace(/^http:\/\//i, "https://");
  return httpsUrl.replace(/\/+$/, "");
}
