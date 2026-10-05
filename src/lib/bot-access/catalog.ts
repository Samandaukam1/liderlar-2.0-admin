/**
 * BOTLAR BOSHQARUVI — RUXSATLAR KATALOGI (sof modul).
 *
 * Har bot va uning har funksiyasi shu yerda bitta kalit bilan yozilgan.
 * Bot kodi tekshiruvni shu kalit bilan qiladi, panel esa shu ro'yxatdan
 * belgilash katakchalarini chizadi — ikkalasi bir manbaga tayanadi va
 * ajralib keta olmaydi.
 *
 * Yangi funksiya qo'shilsa: kalit shu yerga yoziladi va bot kodida
 * `can("…")` bilan tekshiriladi. Bazada sxema o'zgarmaydi — ruxsatlar
 * `bot_access.permissions` massivida matn sifatida turadi.
 *
 * Hech narsa import qilinmaydi: testlar `@/` taxallusini yecha olmaydi.
 */

export type BotFunctionKind = "notify" | "action";

export interface BotFunction {
  key: BotPermission;
  label: string;
  hint: string;
  /** `notify` — bot o'zi yuboradi; `action` — odam tugma/buyruq bilan ishlatadi. */
  kind: BotFunctionKind;
}

export interface BotDefinition {
  key: BotKey;
  label: string;
  description: string;
  functions: BotFunction[];
}

export const BOT_KEYS = ["studio", "sales"] as const;
export type BotKey = (typeof BOT_KEYS)[number];

export const BOT_PERMISSIONS = [
  "studio.posts",
  "studio.payments",
  "studio.channel",
  "studio.autofix",
  "studio.report",
  "studio.batch",
  "studio.crm",
  "studio.blacklist",
  "studio.intake_link",
  "studio.region_poll",
  "sales.operator",
] as const;
export type BotPermission = (typeof BOT_PERMISSIONS)[number];

export const BOTS: readonly BotDefinition[] = [
  {
    key: "studio",
    label: "Liderlar boti (Post Studio)",
    description: "Tayyor postlar, to‘lov savollari va tahririyat tugmalari.",
    functions: [
      {
        key: "studio.posts",
        label: "Tayyor postlarni qabul qilish",
        hint: "Har nashr etilgan nomzod posti shu odamlarga keladi.",
        kind: "notify",
      },
      {
        key: "studio.payments",
        label: "To‘lov savollari va tasdiqlash",
        hint: "“To‘ladimi?” savollari, tasdiqlash tugmalari va /bekor.",
        kind: "notify",
      },
      {
        key: "studio.channel",
        label: "Kanal eslatmalari",
        hint: "“Kanalga qo‘yildimi?” savoli va kanalni ro‘yxatga olish.",
        kind: "notify",
      },
      {
        key: "studio.autofix",
        label: "Avtomatik tuzatish xabarlari",
        hint: "Quvur xatoni o‘zi tuzatganda yuboriladigan xabar.",
        kind: "notify",
      },
      { key: "studio.report", label: "Hisobot", hint: "/hisobot — bot holati va bugungi raqamlar.", kind: "action" },
      { key: "studio.batch", label: "Chop etish navbati", hint: "/chop — nashr navbatini ishga tushirish.", kind: "action" },
      {
        key: "studio.crm",
        label: "CRM ro‘yxatlari",
        hint: "Chop etilganlar, kutayotganlar, to‘ldirayotganlar.",
        kind: "action",
      },
      { key: "studio.blacklist", label: "Qora ro‘yxat", hint: "/qora — qo‘shish va olib tashlash.", kind: "action" },
      { key: "studio.intake_link", label: "Anketa havolasi", hint: "Yangi nomzod uchun anketa havolasi yaratish.", kind: "action" },
      { key: "studio.region_poll", label: "Hudud so‘rovnomasi", hint: "Kanal uchun hudud so‘rovnomasini yuborish.", kind: "action" },
    ],
  },
  {
    key: "sales",
    label: "AI sotuv boti",
    description: "Telegram Business orqali sotuv suhbatlari.",
    functions: [
      {
        key: "sales.operator",
        label: "Operator",
        hint: "Mijoz suhbati operatorga uzatilganda xabar oladi va javob beradi.",
        kind: "notify",
      },
    ],
  },
];

export function isBotPermission(value: unknown): value is BotPermission {
  return typeof value === "string" && (BOT_PERMISSIONS as readonly string[]).includes(value);
}

/** Faqat katalogdagi kalitlar, takrorsiz va katalog tartibida. */
export function cleanPermissions(values: readonly unknown[]): BotPermission[] {
  const wanted = new Set(values.filter(isBotPermission));
  return BOT_PERMISSIONS.filter((key) => wanted.has(key));
}

export function functionLabel(key: BotPermission): string {
  for (const bot of BOTS) {
    const found = bot.functions.find((fn) => fn.key === key);
    if (found) return found.label;
  }
  return key;
}

/* ========================================================================= *
 * TELEGRAM ID
 * ========================================================================= */

/** Telegram ID'lar 64 bitli; JS'da xavfsiz butun son chegarasida qoladi. */
const MAX_ID = 9_999_999_999_999;

export type TelegramIdProblem = "empty" | "not_number" | "zero" | "too_long";

export const TELEGRAM_ID_PROBLEM_TEXT: Record<TelegramIdProblem, string> = {
  empty: "Telegram ID kiritilmadi.",
  not_number: "Telegram ID faqat raqamlardan iborat bo‘lishi kerak (guruh uchun oldida “-”).",
  zero: "Telegram ID 0 bo‘lishi mumkin emas.",
  too_long: "Telegram ID juda uzun.",
};

/**
 * Kiritilgan matnni ID'ga aylantiradi.
 *
 * Bo'sh joylar olib tashlanadi (nusxalashda tez-tez qo'shilib qoladi).
 * Manfiy son — guruh yoki kanal chati, bu ham to'g'ri.
 */
export function parseTelegramId(raw: unknown): { ok: true; id: number } | { ok: false; problem: TelegramIdProblem } {
  const text = String(raw ?? "").replace(/\s+/g, "");
  if (!text) return { ok: false, problem: "empty" };
  if (!/^-?\d+$/.test(text)) return { ok: false, problem: "not_number" };
  const id = Number(text);
  if (!Number.isSafeInteger(id) || Math.abs(id) > MAX_ID) return { ok: false, problem: "too_long" };
  if (id === 0) return { ok: false, problem: "zero" };
  return { ok: true, id };
}

/* ========================================================================= *
 * KIRISH QATORLARI → RUXSATLAR
 * ========================================================================= */

export interface BotAccessRow {
  telegram_id: number | string;
  permissions: readonly unknown[] | null;
  is_active: boolean;
  /** "Faqat o'z nomzodlari" rejimi. */
  own_only?: boolean | null;
}

/** Shu ruxsatga ega FAOL chatlar. Bazadagi bigint matn bo'lib kelishi mumkin. */
export function chatIdsWith(rows: readonly BotAccessRow[], permission: BotPermission): number[] {
  const ids = new Set<number>();
  for (const row of rows) {
    if (!row.is_active) continue;
    if (!(row.permissions ?? []).includes(permission)) continue;
    const parsed = parseTelegramId(row.telegram_id);
    if (parsed.ok) ids.add(parsed.id);
  }
  return [...ids];
}

/** Bitta chatning ruxsatlari. Faol bo'lmasa — bo'sh. */
export function permissionsOf(rows: readonly BotAccessRow[], chatId: number): Set<BotPermission> {
  const row = rows.find((r) => r.is_active && Number(r.telegram_id) === chatId);
  return new Set(cleanPermissions(row?.permissions ?? []));
}

/* ========================================================================= *
 * "FAQAT O'Z NOMZODLARI" REJIMI
 * ========================================================================= */

/**
 * Nomzodga bog'liq funksiyalar — rejim yoqilgan odam ularni faqat o'zi
 * bot orqali yaratgan anketa havolalari bo'yicha oladi. Qolganlari
 * (hisobot, chop etish, hudud so'rovnomasi, …) umumiy: ular bitta
 * nomzodga tegishli emas.
 */
export const PERSONAL_SCOPE: readonly BotPermission[] = [
  "studio.posts",
  "studio.payments",
  "studio.channel",
  "studio.autofix",
  "studio.blacklist",
  "studio.crm",
];

/**
 * Bitta nomzod haqidagi xabar kimga boradi.
 *
 *   - umumiy rejimdagilar — har doim;
 *   - "faqat o'zinikilar" — faqat anketa havolasini AYNAN ular yaratgan
 *     bo'lsa (`creator`). Havola panelda yaratilgan bo'lsa (`null`) —
 *     ularga bormaydi.
 */
export function audienceFor(
  rows: readonly BotAccessRow[],
  permission: BotPermission,
  creator: number | null,
): number[] {
  const ids = new Set<number>();
  for (const row of rows) {
    if (!row.is_active || !(row.permissions ?? []).includes(permission)) continue;
    const parsed = parseTelegramId(row.telegram_id);
    if (!parsed.ok) continue;
    if (row.own_only && parsed.id !== creator) continue;
    ids.add(parsed.id);
  }
  return [...ids];
}
