import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * PAROLNI TIKLASH TOKENI — SOF MODUL.
 *
 * IKKALA REPODA AYNAN BIR XIL FAYL: admin panel tokenni BERADI, sayt
 * esa uni TEKSHIRADI. Hash usuli yoki havola shakli ikki joyda farq
 * qilsa, berilgan havola hech qachon ishlamasdi. Test
 * (`account-recovery.test.ts`) ikki nusxani bayt-baytigacha solishtiradi.
 *
 * Token hisobga kirish huquqini beradi, ya'ni u VAQTINCHALIK KALIT:
 *
 *   - tasodifi kriptografik (192 bit);
 *   - bazada faqat sha256 hash turadi;
 *   - bir martalik;
 *   - muddatli (24 soat);
 *   - aynan bitta hisobga bog'langan.
 *
 * Parol bu yerda YO'Q: uni a'zo o'zi qo'yadi va u to'g'ridan-to'g'ri
 * Supabase Auth'ga boradi.
 */

/** 24 bayt ≈ 192 bit. URL'da qulay, taxmin qilib bo'lmas. */
const TOKEN_BYTES = 24;

/**
 * Havola qancha amal qiladi.
 *
 * Faollashtirishdan (48 soat) QISQA: tiklash mavjud, ichida profil va
 * tarix bor hisobni ochadi. Telegram orqali yetkazish uchun bir kun
 * yetarli; bazadagi cheklov 72 soatdan uzog'iga yo'l qo'ymaydi.
 */
export const RECOVERY_TTL_HOURS = 24;

/** Parol siyosati — ro'yxatdan o'tish va faollashtirish bilan bir xil. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export function hashRecoveryToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedRecovery {
  /** Faqat adminning ekraniga va havolaga chiqadi. Hech qayerda saqlanmaydi. */
  token: string;
  /** Bazaga yoziladi. */
  tokenHash: string;
  expiresAt: string;
}

export function issueRecoveryToken(now: Date): IssuedRecovery {
  // base64url — havolada o'zgarishsiz o'tadi.
  const token = randomBytes(TOKEN_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return {
    token,
    tokenHash: hashRecoveryToken(token),
    expiresAt: new Date(now.getTime() + RECOVERY_TTL_HOURS * 3_600_000).toISOString(),
  };
}

/**
 * Havoladan kelgan matn token shakliga mosmi.
 *
 * Bazaga borishdan OLDIN: tasodifiy yoki atayin uzun matn uchun hash
 * hisoblab, so'rov yuborishga hojat yo'q.
 */
export function looksLikeRecoveryToken(value: string | null | undefined): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32}$/.test(value);
}

export type RecoveryState = "active" | "consumed" | "revoked" | "expired" | "not_found";

export interface StoredRecovery {
  tokenHash: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
}

/**
 * Saqlangan havolaning holati.
 *
 * TARTIB MUHIM: bekor qilingan havola muddati o'tgan bo'lsa ham
 * "bekor qilingan" — admin uni ataylab yopgan va bu muhimroq.
 */
export function recoveryState(stored: StoredRecovery | null, now: Date): RecoveryState {
  if (!stored) return "not_found";
  if (stored.revokedAt) return "revoked";
  if (stored.consumedAt) return "consumed";

  const expires = new Date(stored.expiresAt);
  if (!Number.isFinite(expires.getTime()) || expires <= now) return "expired";

  return "active";
}

/**
 * Taqdim etilgan tokenni saqlangani bilan solishtiradi.
 *
 * Hash doimiy vaqtda taqqoslanadi: aks holda javob tezligi hujumchiga
 * to'g'ri prefiksni topishga yordam berardi.
 */
export function checkRecoveryToken(
  presented: string,
  stored: StoredRecovery | null,
  now: Date,
): { ok: true } | { ok: false; reason: Exclude<RecoveryState, "active"> } {
  if (!stored) return { ok: false, reason: "not_found" };

  const a = Buffer.from(hashRecoveryToken(presented));
  const b = Buffer.from(stored.tokenHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    // "Noto'g'ri" emas, "topilmadi": farq tokenlar haqida ma'lumot berardi.
    return { ok: false, reason: "not_found" };
  }

  const state = recoveryState(stored, now);
  return state === "active" ? { ok: true } : { ok: false, reason: state };
}

export const RECOVERY_FAILURE_TEXT: Readonly<Record<Exclude<RecoveryState, "active">, string>> = {
  not_found: "Havola tanilmadi. Administratordan yangi havola so'rang.",
  consumed: "Bu havola allaqachon ishlatilgan. Yangi parolingiz bilan kiring.",
  revoked: "Bu havola bekor qilingan. Administratordan yangi havola so'rang.",
  expired: "Havolaning muddati tugagan. Administratordan yangi havola so'rang.",
};

/**
 * Yangi parolni tekshiradi. `null` — parol yaroqli.
 *
 * Tasdiqlash maydoni ham shu yerda: ikki nusxa farq qilsa, a'zo o'zi
 * bilmagan parol bilan qolib, yana admin oldiga qaytardi.
 */
export function checkNewPassword(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Parol kamida ${PASSWORD_MIN_LENGTH} belgidan iborat bo'lsin.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) return "Parol juda uzun.";
  if (password.trim().length === 0) return "Parol faqat bo'sh joydan iborat bo'lmasin.";
  if (password !== confirm) return "Parollar bir xil emas.";
  return null;
}

/** Ommaviy saytdagi tiklash sahifasi. */
export function recoveryUrl(siteUrl: string, token: string): string {
  return new URL(`/akkaunt/tiklash/${encodeURIComponent(token)}`, siteUrl).toString();
}
