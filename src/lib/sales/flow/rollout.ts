/**
 * ROLLOUT REJIMLARI (28-band).
 *
 * OFF dan to'g'ridan-to'g'ri hamma mijozga o'tish — eng qimmat xato
 * turi: noto'g'ri javob bir vaqtning o'zida yuzlab odamga ketadi va
 * uni qaytarib bo'lmaydi. Shuning uchun oraliq bosqichlar bor.
 *
 * FOIZLI CHIQARISH BARQAROR: har xabarda tasodif olinsa, bitta mijoz
 * birinchi xabariga javob olib, ikkinchisiga olmay qolardi — bu
 * texnik nosozlikdan ham yomonroq taassurot qoldiradi. Shuning uchun
 * har suhbatga BIR MARTA 0–99 raqam beriladi va u o'zgarmaydi.
 *
 * SOF MODUL.
 */

export const ROLLOUT_MODES = ["off", "test_only", "allowlist", "percentage", "full"] as const;
export type RolloutMode = (typeof ROLLOUT_MODES)[number];

export const ROLLOUT_MODE_LABELS: Record<RolloutMode, string> = {
  off: "O‘chiq — hech kimga yozilmaydi",
  test_only: "Faqat sinov — admin panelidagi sinov chatida",
  allowlist: "Tanlangan chatlar — faqat ro‘yxatdagilar",
  percentage: "Foiz bo‘yicha — suhbatlarning bir qismi",
  full: "To‘liq — barcha mijozlar",
};

export interface RolloutSettings {
  mode: RolloutMode;
  /** `allowlist` rejimida javob beriladigan Telegram chat id'lari. */
  allowlistChatIds: readonly number[];
  /** `percentage` rejimida 0–100. */
  percentage: number;
}

export const DEFAULT_ROLLOUT: RolloutSettings = {
  mode: "off",
  allowlistChatIds: [],
  percentage: 0,
};

export function isRolloutMode(value: unknown): value is RolloutMode {
  return typeof value === "string" && (ROLLOUT_MODES as readonly string[]).includes(value);
}

export function parseRollout(value: unknown): RolloutSettings {
  if (!value || typeof value !== "object") return DEFAULT_ROLLOUT;
  const raw = value as Record<string, unknown>;

  // Faqat TANILGAN rejim qabul qilinadi. Nosoz qiymat botni jim
  // qoldiradi — noto'g'ri javob yuborishdan xavfsizroq.
  const mode = isRolloutMode(raw.mode) ? raw.mode : "off";

  const ids = Array.isArray(raw.allowlistChatIds)
    ? raw.allowlistChatIds
        .map((v) => Number(String(v).trim()))
        .filter((n) => Number.isSafeInteger(n) && n !== 0)
    : [];

  const rawPercentage = typeof raw.percentage === "number" ? Math.round(raw.percentage) : 0;
  const percentage = Number.isFinite(rawPercentage)
    ? Math.max(0, Math.min(100, rawPercentage))
    : 0;

  return { mode, allowlistChatIds: ids, percentage };
}

export type RolloutDecision =
  | { allowed: true; reason: RolloutMode }
  | { allowed: false; reason: "rollout_off" | "rollout_not_allowlisted" | "rollout_outside_percentage" | "rollout_test_only" };

export interface RolloutContext {
  settings: RolloutSettings;
  chatId: number | null;
  /** Suhbatga bir marta berilgan barqaror raqam (0–99). */
  bucket: number | null;
  /** Sinov oynasidan kelgan chaqiruv. */
  simulated: boolean;
}

/**
 * Shu suhbatga avtomatik javob berish mumkinmi.
 *
 * Sinov rejimi ALOHIDA: u Telegram'ga umuman chiqmaydi, shuning uchun
 * `test_only` da ham, boshqa rejimlarda ham o'tadi. Uni bloklash
 * adminning o'z panelida sinashiga to'sqinlik qilardi.
 */
export function decideRollout(context: RolloutContext): RolloutDecision {
  const { mode } = context.settings;

  if (context.simulated) return { allowed: true, reason: mode };

  switch (mode) {
    case "off":
      return { allowed: false, reason: "rollout_off" };
    case "test_only":
      return { allowed: false, reason: "rollout_test_only" };
    case "full":
      return { allowed: true, reason: "full" };
    case "allowlist":
      return context.chatId != null && context.settings.allowlistChatIds.includes(context.chatId)
        ? { allowed: true, reason: "allowlist" }
        : { allowed: false, reason: "rollout_not_allowlisted" };
    case "percentage": {
      // Raqam yo'q bo'lsa — hali berilmagan. Ichkariga kiritmaymiz:
      // "noma'lum" ni "kiradi" deb o'qish foizni ma'nosiz qilardi.
      if (context.bucket == null) {
        return { allowed: false, reason: "rollout_outside_percentage" };
      }
      return context.bucket < context.settings.percentage
        ? { allowed: true, reason: "percentage" }
        : { allowed: false, reason: "rollout_outside_percentage" };
    }
  }
}

/** Yangi suhbatga beriladigan barqaror raqam. */
export function newRolloutBucket(): number {
  return Math.floor(Math.random() * 100);
}
