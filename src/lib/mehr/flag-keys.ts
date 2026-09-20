/**
 * MEHR bayroqlarining KALITLARI va TIPI — SOF MODUL.
 *
 * Nega alohida: `flags.ts` da `import "server-only"` bor va u
 * bazaga boradi. Mijoz komponenti undan hatto TIPNI ham import
 * qilsa, bundler butun modulni brauzer paketiga tortadi va
 * build yiqiladi — `tsc` esa buni ko'rmaydi.
 *
 * Bu yerda faqat kalit nomlari va shakl. Qiymatlar hech qachon
 * bu yerda turmaydi.
 */

export const MEHR_FLAG_KEYS = {
  publicEnabled: "mehr.public_enabled",
  activityCreationEnabled: "mehr.activity_creation_enabled",
  qrCheckinEnabled: "mehr.qr_checkin_enabled",
  pointsEnabled: "mehr.points_enabled",
  certificatesEnabled: "mehr.certificates_enabled",
  memberAuthEnabled: "member.auth_enabled",
  memberBotEnabled: "member.bot_enabled",
  accountActivationEnabled: "member.account_activation_enabled",
  referralPointsEnabled: "referral.points_enabled",
} as const;

export type MehrFlagKey = (typeof MEHR_FLAG_KEYS)[keyof typeof MEHR_FLAG_KEYS];

export type MehrFlags = Record<keyof typeof MEHR_FLAG_KEYS, boolean>;

/**
 * Hammasi o'chiq holat.
 *
 * Sozlama o'qilmasa yoki kutilmagan qiymat bo'lsa, tizim
 * shu holatga qaytadi: ochilib ketgan xususiyatni keyin
 * yopish, yopiq turganini ochishdan qimmatga tushadi.
 */
export const ALL_FLAGS_OFF: MehrFlags = {
  publicEnabled: false,
  activityCreationEnabled: false,
  qrCheckinEnabled: false,
  pointsEnabled: false,
  certificatesEnabled: false,
  memberAuthEnabled: false,
  memberBotEnabled: false,
  accountActivationEnabled: false,
  referralPointsEnabled: false,
};
