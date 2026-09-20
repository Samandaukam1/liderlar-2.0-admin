import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Telegram bog'lash tokeni — SOF MODUL (§16).
 *
 * TOKENNING O'ZI BAZAGA YOZILMAYDI. Bazada faqat sha256 hash
 * turadi. Baza nusxasi sizib chiqsa ham, undan ishlaydigan
 * bog'lash havolasi yasab bo'lmaydi.
 */

/** Telegram `start` parametri uzunligi cheklangan — 32 belgi xavfsiz chegara. */
const TOKEN_BYTES = 16;

export const LINK_TOKEN_TTL_SECONDS = 10 * 60;

export interface IssuedLinkToken {
  /** Foydalanuvchiga beriladi. Bazada SAQLANMAYDI. */
  token: string;
  /** Bazaga yoziladi. */
  tokenHash: string;
  expiresAt: string;
}

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueLinkToken(now: Date, ttlSeconds = LINK_TOKEN_TTL_SECONDS): IssuedLinkToken {
  // base64url — Telegram deep-link'da xavfsiz o'tadi.
  const token = randomBytes(TOKEN_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return {
    token,
    tokenHash: hashLinkToken(token),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
  };
}

export interface StoredLinkToken {
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
}

export type LinkTokenCheck =
  | { ok: true }
  | { ok: false; reason: "not_found" | "already_used" | "expired" };

/**
 * Tokenni tekshiradi.
 *
 * Hash taqqoslash ham doimiy vaqtda: aks holda javob qaytish
 * tezligi hujumchiga to'g'ri prefiksni topishga yordam berardi.
 */
export function checkLinkToken(
  presentedToken: string,
  stored: StoredLinkToken | null,
  now: Date,
): LinkTokenCheck {
  if (!stored) return { ok: false, reason: "not_found" };

  const a = Buffer.from(hashLinkToken(presentedToken));
  const b = Buffer.from(stored.tokenHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "not_found" };
  }

  // BIR MARTALIK: ishlatilgan token qayta qabul qilinmaydi.
  if (stored.usedAt) return { ok: false, reason: "already_used" };

  const expires = new Date(stored.expiresAt);
  if (!Number.isFinite(expires.getTime()) || expires <= now) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true };
}
