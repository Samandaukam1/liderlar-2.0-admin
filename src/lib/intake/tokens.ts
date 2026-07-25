import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Candidate secure-link tokens.
 *
 * Pure crypto (unit-tested, like src/lib/tokens.ts) — no `server-only` import
 * so it can run under `node --test`. It is only ever imported from server code,
 * and CANDIDATE_LINK_SECRET has no NEXT_PUBLIC prefix, so it is never present in
 * a client bundle (a client import would throw at hash time, not leak).
 *
 * Security model:
 *   - The raw token is shown to the admin exactly ONCE at creation and never
 *     stored, logged, or sent to any audit/error sink.
 *   - Only an HMAC-SHA256(raw, CANDIDATE_LINK_SECRET) digest (hex, 64 chars)
 *     is persisted in candidate_intake_links.token_hash.
 *   - Verification hashes the incoming raw token and compares digests with a
 *     timing-safe equality check.
 */

function linkSecret(): string {
  const secret = process.env.CANDIDATE_LINK_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "CANDIDATE_LINK_SECRET is missing or too short (>= 32 bytes required)",
    );
  }
  return secret;
}

/** 32 cryptographically-random bytes, base64url. Shown to the admin once. */
export function generateRawIntakeToken(): string {
  return randomBytes(32).toString("base64url");
}

/** HMAC-SHA256 keyed by CANDIDATE_LINK_SECRET. Only this is ever stored. */
export function hashIntakeToken(raw: string): string {
  return createHmac("sha256", linkSecret()).update(raw).digest("hex");
}

/**
 * A short, non-reversible-in-practice display prefix for the admin UI so links
 * can be told apart without revealing the token. Derived from the HASH (not the
 * raw token), so it leaks nothing about the secret value itself.
 */
export function tokenPrefix(raw: string): string {
  return hashIntakeToken(raw).slice(0, 8);
}

/** Timing-safe comparison of two hex digests of equal length. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** Public form URL for a freshly-minted raw token. */
export function buildIntakeLink(rawToken: string): string {
  const base =
    process.env.NEXT_PUBLIC_INTAKE_BASE_URL ??
    `${(process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001").replace(/\/$/, "")}/anketa`;
  return `${base.replace(/\/$/, "")}/${rawToken}`;
}

/**
 * Extracts the raw token from a request: JSON body `token`, form field `token`,
 * or `Authorization: Bearer <token>`. Never logs the value.
 */
export function extractRawToken(
  headers: Headers,
  bodyToken?: unknown,
): string | null {
  if (typeof bodyToken === "string" && bodyToken.length >= 20) return bodyToken;
  const auth = headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const t = auth.slice(7).trim();
    if (t.length >= 20) return t;
  }
  return null;
}
