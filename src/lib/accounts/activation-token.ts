import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Faollashtirish tokeni — SOF MODUL.
 *
 * Bu token nomzodning hisobini ochish huquqini beradi, ya'ni u
 * amalda VAQTINCHALIK KALIT. Shuning uchun:
 *
 *   - tasodifi kriptografik;
 *   - bazada faqat sha256 hash turadi;
 *   - bir martalik;
 *   - muddatli;
 *   - aynan bitta nomzodga bog'langan.
 *
 * Parol degan tushuncha bu yerda YO'Q va bo'lmaydi ham:
 * nomzod o'z parolini o'zi qo'yadi va uni hech kim ko'rmaydi.
 */

/** 24 bayt ≈ 192 bit. URL'da qulay, taxmin qilib bo'lmas. */
const TOKEN_BYTES = 24;

export const DEFAULT_TTL_HOURS = 48;
const MIN_TTL_HOURS = 1;
const MAX_TTL_HOURS = 24 * 14;

export function hashActivationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedActivation {
  /** Faqat adminning ekraniga va nomzodning havolasiga chiqadi. */
  token: string;
  /** Bazaga yoziladi. */
  tokenHash: string;
  expiresAt: string;
}

export function issueActivationToken(
  now: Date,
  ttlHours: number = DEFAULT_TTL_HOURS,
): IssuedActivation {
  // base64url — havolada o'zgarishsiz o'tadi va qo'shimcha kodlash talab qilmaydi.
  const token = randomBytes(TOKEN_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const hours = clampTtl(ttlHours);

  return {
    token,
    tokenHash: hashActivationToken(token),
    expiresAt: new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString(),
  };
}

/**
 * Sozlamadagi qiymatni xavfsiz chegaraga soladi.
 *
 * Sozlamaga tasodifan "0" yoki "99999" yozilishi mumkin.
 * Birinchisi taklifnomani darhol o'lik qilardi, ikkinchisi esa
 * uni amalda abadiy amal qiladigan kalitga aylantirardi.
 */
export function clampTtl(hours: number): number {
  if (!Number.isFinite(hours)) return DEFAULT_TTL_HOURS;
  return Math.min(Math.max(Math.floor(hours), MIN_TTL_HOURS), MAX_TTL_HOURS);
}

export type ActivationState =
  | "active"
  | "consumed"
  | "revoked"
  | "expired"
  | "not_found";

export interface StoredActivation {
  tokenHash: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
}

/**
 * Saqlangan taklifnomaning holatini aniqlaydi.
 *
 * TARTIB MUHIM: bekor qilingan taklifnoma muddati o'tgan
 * bo'lsa ham "bekor qilingan" deb ko'rsatiladi. Admin uni
 * ataylab bekor qilgan va bu sabab "muddati tugadi" dan
 * muhimroq.
 */
export function activationState(
  stored: StoredActivation | null,
  now: Date,
): ActivationState {
  if (!stored) return "not_found";
  if (stored.revokedAt) return "revoked";
  if (stored.consumedAt) return "consumed";

  const expires = new Date(stored.expiresAt);
  if (!Number.isFinite(expires.getTime()) || expires <= now) return "expired";

  return "active";
}

export type TokenCheck =
  | { ok: true }
  | { ok: false; reason: Exclude<ActivationState, "active"> };

/**
 * Taqdim etilgan tokenni saqlangani bilan solishtiradi.
 *
 * Hash taqqoslash doimiy vaqtda: aks holda javob qaytish
 * tezligi hujumchiga to'g'ri prefiksni topishga yordam berardi.
 */
export function checkActivationToken(
  presented: string,
  stored: StoredActivation | null,
  now: Date,
): TokenCheck {
  if (!stored) return { ok: false, reason: "not_found" };

  const a = Buffer.from(hashActivationToken(presented));
  const b = Buffer.from(stored.tokenHash);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    /*
     * "Topilmadi" deymiz, "noto'g'ri" emas.
     *
     * Farqni ko'rsatish tokenlar qanday saqlanishi haqida
     * ma'lumot berardi va mavjud taklifnomani taxmin qilishni
     * osonlashtirardi.
     */
    return { ok: false, reason: "not_found" };
  }

  const state = activationState(stored, now);
  return state === "active" ? { ok: true } : { ok: false, reason: state };
}

export const ACTIVATION_FAILURE_TEXT: Readonly<Record<Exclude<ActivationState, "active">, string>> = {
  not_found: "Havola tanilmadi. Administratordan yangi havola so'rang.",
  consumed: "Bu havola allaqachon ishlatilgan. Agar hisobingiz yaratilgan bo'lsa, kiring.",
  revoked: "Bu havola bekor qilingan. Administratordan yangi havola so'rang.",
  expired: "Havolaning muddati tugagan. Administratordan yangi havola so'rang.",
};

/** Faollashtirish havolasi. */
export function activationUrl(baseUrl: string, token: string): string {
  return new URL(`/akkaunt/faollashtirish/${encodeURIComponent(token)}`, baseUrl).toString();
}
