/**
 * BOT SUHBATI — QADAMLAR VA QOIDALAR. SOF MODUL.
 *
 * Hech narsa import qilinmaydi: testlar `@/` taxallusini yecha olmaydi.
 *
 * §20: bosqichma-bosqich ma'lumot kiritish uchun bot nima
 * kutayotganini ESLAB QOLISHI kerak. Mavjud menyu holatsiz ishlaydi
 * va u menyular uchun to'g'ri, lekin "nomini yozing -> sanani
 * tanlang" oqimi uchun yetarli emas.
 */

/* ========================================================================= *
 * QADAMLAR
 * ========================================================================= */

export const CONVERSATION_STEPS = [
  /** Bo'lim tanlangan, nom kutilyapti. */
  "entry_title",
  /** Nom olindi, qo'shimcha matn kutilyapti (ixtiyoriy). */
  "entry_subtitle",
  /** Yil kutilyapti. */
  "entry_year",
  /** Oy kutilyapti. */
  "entry_month",
  /** Kun kutilyapti. */
  "entry_day",
  /** Tasdiq kutilyapti. */
  "entry_confirm",
  /** Qisqa ma'lumot matni kutilyapti. */
  "bio_text",
  /** Rasm kutilyapti. */
  "photo_wait",
] as const;

export type ConversationStep = (typeof CONVERSATION_STEPS)[number];

export function isStep(value: unknown): value is ConversationStep {
  return (
    typeof value === "string" && (CONVERSATION_STEPS as readonly string[]).includes(value)
  );
}

/* ========================================================================= *
 * ESKIRISH
 * ========================================================================= */

/**
 * Suhbat qancha vaqtdan keyin eskiradi.
 *
 * 30 DAQIQA. Yarim qolgan suhbat abadiy turmasligi kerak: odam bir
 * hafta oldin "nomini yozing" savolida to'xtab qolsa, bugun yozgan
 * tasodifiy xabari o'sha savolga javob deb qabul qilinardi va
 * profiliga ma'nosiz yozuv tushardi.
 *
 * 30 daqiqa — bir o'tirishda ma'lumot kiritish uchun yetarli, lekin
 * keyingi kunga yetib bormaydigan muddat.
 */
export const STALE_AFTER_MS = 30 * 60 * 1000;

export function isStale(updatedAt: Date, now: Date): boolean {
  return now.getTime() - updatedAt.getTime() > STALE_AFTER_MS;
}

/* ========================================================================= *
 * SANA QISMLARI — §20
 * ========================================================================= */

export const MONTHS_UZ = [
  "Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun",
  "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr",
] as const;

/**
 * Yilni tekshiradi.
 *
 * Yuqori chegara JORIY YILGA bog'langan, qotib yozilmagan: 2030 deb
 * yozilsa, kod 2031 yilda noto'g'ri ishlab qolardi.
 *
 * Pastki chegara 1900: undan oldingi ta'lim yoki ish tajribasi
 * ensiklopediyada bo'lishi mumkin emas va bunday qiymat xato
 * kiritishdan kelib chiqadi.
 */
export function parseYear(input: string, now: Date): number | null {
  const value = Number(input.trim());
  if (!Number.isInteger(value)) return null;
  if (value < 1900 || value > now.getFullYear()) return null;
  return value;
}

/** Oy raqami (1–12). */
export function parseMonth(input: string): number | null {
  const value = Number(input.trim());
  if (!Number.isInteger(value) || value < 1 || value > 12) return null;
  return value;
}

/**
 * Kunni tekshiradi — OY VA YILGA QARAB.
 *
 * `new Date(2026, 1, 31)` xato bermaydi, 3-martga aylanadi. Shuning
 * uchun oyning haqiqiy kun sonini hisoblaymiz: aks holda odam
 * "31-fevral" deb kiritsa, profilida boshqa sana paydo bo'lardi.
 */
export function parseDay(input: string, year: number, month: number): number | null {
  const value = Number(input.trim());
  if (!Number.isInteger(value) || value < 1) return null;

  // Keyingi oyning 0-kuni — shu oyning oxirgi kuni.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (value > lastDay) return null;
  return value;
}

/** `YYYY-MM-DD` yasaydi. */
export function buildDate(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/* ========================================================================= *
 * MATN TEKSHIRUVI
 * ========================================================================= */

export const TITLE_MIN = 2;
export const TITLE_MAX = 300;
export const BIO_MAX = 600;

export type TextProblem = "empty" | "too_short" | "too_long" | "command";

export const TEXT_PROBLEM_TEXT: Record<TextProblem, string> = {
  empty: "Matn bo'sh. Qaytadan yozing.",
  too_short: "Juda qisqa. Kamida 2 belgi yozing.",
  too_long: "Juda uzun. Qisqartirib yozing.",
  command:
    "Bu buyruqqa o'xshaydi. Agar bekor qilmoqchi bo'lsangiz, /bekor deb yozing.",
};

/**
 * Kiritilgan matnni tekshiradi.
 *
 * BUYRUQ ALOHIDA RAD ETILADI. Odam suhbat o'rtasida `/start` yozsa,
 * uni ta'lim muassasasining nomi deb qabul qilish profiliga "/start"
 * degan yozuv qo'shardi.
 */
export function checkText(
  input: string,
  max = TITLE_MAX,
): { ok: true; value: string } | { ok: false; problem: TextProblem } {
  const value = input.trim();

  if (value === "") return { ok: false, problem: "empty" };
  if (value.startsWith("/")) return { ok: false, problem: "command" };
  if (value.length < TITLE_MIN) return { ok: false, problem: "too_short" };
  if (value.length > max) return { ok: false, problem: "too_long" };

  return { ok: true, value };
}

/* ========================================================================= *
 * KEYINGI QADAM
 * ========================================================================= */

export interface ConversationDraft {
  kind?: string;
  title?: string;
  subtitle?: string;
  year?: number;
  month?: number;
  day?: number;
  /** Bu tur uchun sana kerakmi. */
  hasDates?: boolean;
}

/**
 * Qadam bajarilgandan keyin keyingisi.
 *
 * `null` — oqim tugadi.
 *
 * SANASIZ TURLAR SANA QADAMLARINI O'TKAZIB YUBORADI: o'qilgan kitob
 * yoki ijtimoiy tarmoq havolasi uchun sana so'rash ma'nosiz va odam
 * uchta keraksiz savolga javob berishga majbur bo'lardi.
 */
export function nextStep(
  current: ConversationStep,
  draft: ConversationDraft,
): ConversationStep | null {
  switch (current) {
    case "entry_title":
      return "entry_subtitle";
    case "entry_subtitle":
      return draft.hasDates ? "entry_year" : "entry_confirm";
    case "entry_year":
      return "entry_month";
    case "entry_month":
      return "entry_day";
    case "entry_day":
      return "entry_confirm";
    case "entry_confirm":
    case "bio_text":
    case "photo_wait":
      return null;
  }
}

/* ========================================================================= *
 * TASDIQ MATNI — §22
 * ========================================================================= */

/**
 * Tasdiqlashdan oldin ko'rsatiladigan xulosa.
 *
 * §22 ESKI va YANGI qiymatni ko'rsatishni talab qiladi. Yangi yozuv
 * uchun eski qiymat yo'q, shuning uchun faqat yangisi ko'rsatiladi —
 * lekin TO'LIQ: odam nima saqlanayotganini ko'rmasa, tasdiqlash
 * ma'noga ega bo'lmaydi.
 */
export function confirmSummary(draft: ConversationDraft): string {
  const lines: string[] = [];

  if (draft.title) lines.push(`Nomi: ${draft.title}`);
  if (draft.subtitle) lines.push(`Qo'shimcha: ${draft.subtitle}`);

  if (draft.year) {
    const month = draft.month ? MONTHS_UZ[draft.month - 1] : null;
    const parts = [String(draft.year)];
    if (month) parts.unshift(month);
    if (draft.day) parts.unshift(String(draft.day));
    lines.push(`Sana: ${parts.join(" ")}`);
  }

  return lines.join("\n");
}

/**
 * Saqlashdan keyin aytiladigan matn.
 *
 * §22: ko'rikka ketgan yozuv uchun "Profilga joylandi" deb aytish
 * YOLG'ON bo'lardi. Shuning uchun matn aynan nima bo'lganini aytadi.
 */
export function savedMessage(needsReview: boolean): string {
  return needsReview
    ? "✅ Tekshiruvga yuborildi. Tahririyat tasdiqlagandan keyin profilingizda ko'rinadi."
    : "✅ Profilga joylandi.";
}
