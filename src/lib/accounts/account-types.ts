/**
 * Hisob boshqaruvining TIPLARI — SOF MODUL.
 *
 * Nega alohida: `account-report.ts` da `import "server-only"`
 * bor. Mijoz komponenti undan tipni import qilsa, bundler
 * butun modulni brauzer paketiga tortadi va build yiqiladi —
 * `tsc` esa buni ko'rmaydi. Bu loyihada bunday xato ikki marta
 * sodir bo'lgan.
 */

export type AccountState =
  | "no_account"
  | "activation_pending"
  | "active"
  | "blocked"
  | "needs_attention";

export type AccountFilter =
  | "all"
  | "linked"
  | "unlinked"
  | "pending"
  | "telegram"
  | "blocked"
  | "attention";

export interface AccountCounts {
  totalCandidates: number;
  linked: number;
  unlinked: number;
  activationPending: number;
  telegramLinked: number;
  blocked: number;
  /** Taklifnoma ishlatilgan, lekin nomzod bog'lanmagan. */
  needsAttention: number;
}

export interface AccountRow {
  candidateId: string;
  slug: string | null;
  fullName: string;
  avatarUrl: string | null;
  regionName: string | null;
  candidateStatus: string;

  /*
   * Auth foydalanuvchi id — `candidates.user_id`.
   *
   * Nomzod id dan ATAYLAB alohida maydon: bloklash, parol
   * tiklash va xavfsizlik hodisalari PROFILGA tegishli, nomzod
   * yozuviga emas. Ikkisini bir maydonda saqlash yoki
   * birini ikkinchisi o'rniga uzatish jimgina noto'g'ri
   * odamga ta'sir qilardi.
   */
  profileId: string | null;

  hasAccount: boolean;
  state: AccountState;

  activationExpiresAt: string | null;
  lastLoginAt: string | null;

  telegramLinked: boolean;
  telegramUsername: string | null;
}

export const ACCOUNT_STATE_LABEL: Readonly<Record<AccountState, string>> = {
  no_account: "Akkaunt yo'q",
  activation_pending: "Aktivatsiya kutilmoqda",
  active: "Faol",
  blocked: "Bloklangan",
  needs_attention: "E'tibor kerak",
};

export const ACCOUNT_FILTER_LABEL: Readonly<Record<AccountFilter, string>> = {
  all: "Hammasi",
  linked: "Akkaunt bor",
  unlinked: "Akkaunt yo'q",
  pending: "Aktivatsiya kutilmoqda",
  telegram: "Telegram ulangan",
  blocked: "Bloklangan",
  attention: "E'tibor kerak",
};
