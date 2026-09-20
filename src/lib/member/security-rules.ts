/**
 * A'zo xavfsizligi — SOF MODUL.
 *
 * MUHIM OGOHLANTIRISH (§18): BRAUZER BARMOQ IZI ANIQ SHAXS EMAS.
 *
 * `deviceHash` — bir nechta oddiy belgidan olingan taxmin. U:
 *   - bitta odamning ikki brauzerida boshqacha bo'ladi;
 *   - yangilanishdan keyin o'zgarishi mumkin;
 *   - ikki xil odamda bir xil chiqishi mumkin.
 *
 * Shuning uchun u YAGONA asos emas, QATLAMLI SIGNALLARDAN biri.
 * Blok — "kafolat" emas, "to'siq".
 */

export type DeviceStatus = "untrusted" | "trusted" | "blocked";

/**
 * Ushlab turish paytida TO'SILADIGAN amallar.
 *
 * Ro'yxat ataylab qisqa: faqat zarar yetkaza oladigan amallar.
 * O'z profilini o'qish, reytingni ko'rish, sertifikatini ochish —
 * bularning hammasi OCHIQ qoladi. Aks holda haqiqiy egasi yangi
 * telefonidan kirib, bir soat davomida hech nima qila olmay
 * qolardi va bu xavfsizlik emas, xalaqit bo'lardi.
 */
export const HOLD_BLOCKED_ACTIONS = [
  "password_change",
  "email_change",
  "telegram_unlink",
  "account_delete",
  "certificate_manage",
  "referral_payout",
  "profile_sensitive_edit",
  "session_revoke_other",
] as const;

export type SensitiveAction = (typeof HOLD_BLOCKED_ACTIONS)[number];

export interface SessionState {
  deviceStatus: DeviceStatus;
  holdUntil: string | null;
  revokedAt: string | null;
}

export type ActionGate =
  | { allowed: true }
  | { allowed: false; reason: "session_revoked" | "device_blocked" | "security_hold"; holdUntil?: string };

export function gateSensitiveAction(session: SessionState, now: Date): ActionGate {
  if (session.revokedAt) return { allowed: false, reason: "session_revoked" };
  if (session.deviceStatus === "blocked") return { allowed: false, reason: "device_blocked" };

  if (session.holdUntil) {
    const until = new Date(session.holdUntil);
    if (Number.isFinite(until.getTime()) && until > now) {
      return { allowed: false, reason: "security_hold", holdUntil: session.holdUntil };
    }
  }

  return { allowed: true };
}

/** Faqat o'qish — ushlab turish paytida ham ochiq. */
export function gateReadAccess(session: SessionState): ActionGate {
  if (session.revokedAt) return { allowed: false, reason: "session_revoked" };
  if (session.deviceStatus === "blocked") return { allowed: false, reason: "device_blocked" };
  return { allowed: true };
}

export interface NewDeviceDecision {
  isNewDevice: boolean;
  holdUntil: string | null;
  notifyTelegram: boolean;
}

/**
 * Kirish paytida qurilma holatini hal qiladi.
 *
 * Ishonchli qurilmada ushlab turish ham, xabarnoma ham yo'q:
 * odam har kuni o'z noutbukidan kirib, har safar Telegram'da
 * ogohlantirish olsa, xabarnomalar ma'nosini yo'qotadi va
 * haqiqiy hodisa ham e'tiborsiz qolardi.
 */
export function decideNewDevice(
  known: { status: DeviceStatus } | null,
  now: Date,
  holdMinutes: number,
): NewDeviceDecision {
  if (known && known.status === "trusted") {
    return { isNewDevice: false, holdUntil: null, notifyTelegram: false };
  }

  const holdUntil = new Date(now.getTime() + holdMinutes * 60_000).toISOString();
  return { isNewDevice: true, holdUntil, notifyTelegram: true };
}

/** Rad etilgan qurilma qachongacha bloklanadi (§18). */
export function blockedUntil(now: Date, days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60_000).toISOString();
}

export function isBlockExpired(blockedUntilIso: string | null, now: Date): boolean {
  if (!blockedUntilIso) return false;
  const until = new Date(blockedUntilIso);
  return Number.isFinite(until.getTime()) && until <= now;
}
