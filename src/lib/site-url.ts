import "server-only";

/**
 * Resolves the production public-site origin (liderlar-web), with guards
 * specific to contexts — like the certificate QR — where a wrong URL would
 * end up baked into a downloadable, hard-to-recall document: no localhost,
 * no accidental Vercel preview deployment, https only.
 */
export function getSiteUrl(): string {
  if (process.env.VERCEL_ENV === "preview") {
    throw new Error("Refusing to resolve a production site URL on a Vercel preview deployment.");
  }

  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://liderlar.uz").trim();
  const trimmed = base.replace(/\/+$/, "");

  if (/localhost|127\.0\.0\.1/i.test(trimmed)) {
    throw new Error("NEXT_PUBLIC_SITE_URL points at localhost.");
  }
  if (!trimmed.startsWith("https://")) {
    throw new Error("Site URL must be an https:// URL.");
  }

  return trimmed;
}
