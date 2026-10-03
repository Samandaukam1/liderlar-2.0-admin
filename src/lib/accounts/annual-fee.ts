/**
 * YILLIK TEXNIK BADAL (38 000 so'm) — HOLAT HISOBI. SOF MODUL.
 *
 * Sikl BIRINCHI NASHR sanasidan (`candidates.published_at`, Toshkent
 * kuni) — har yili o'sha kun. Birinchi yil nashr bilan boshlanadi;
 * birinchi badal — birinchi yilliq kunida.
 *
 * "TO'LANGAN" FAQAT `annual_fee_payments` dagi yozuvdan (admin qo'yadi).
 * Sana, brauzer yoki nashr to'lovidan "to'landi" deb xulosa CHIQARILMAYDI.
 *
 * Hech narsa import qilmaydi — testlar `@/` ni ko'rmaydi.
 */

export const ANNUAL_FEE_UZS = 38_000;
/** Shuncha kun qolganda karta ogohlantiradi. */
export const ANNUAL_FEE_WARN_DAYS = 30;

export type AnnualFeeState =
  /** Nashr sanasi noma'lum — sana TAXMIN QILINMAYDI. */
  | "unknown"
  /** Keyingi badalgacha vaqt bor. */
  | "upcoming"
  /** Keyingi badalgacha ≤ 30 kun. */
  | "soon"
  /** Joriy sikl uchun to'lov qayd etilgan. */
  | "paid"
  /** Badal kuni o'tgan, joriy sikl uchun to'lov qayd etilmagan. */
  | "overdue";

export interface AnnualFeeStatus {
  state: AnnualFeeState;
  amountUzs: number;
  /** Birinchi nashr kuni (YYYY-MM-DD). */
  referenceDate: string | null;
  /** Keyingi to'lov kuni (yoki muddati o'tgan to'lov kuni). */
  dueDate: string | null;
  /** `dueDate` gacha qolgan kun (overdue da — o'tgan kunlar, manfiy). */
  daysLeft: number | null;
}

const DAY_MS = 86_400_000;

/** UTC lahza -> Toshkent kalendar kuni (UTC+5, Uzbekistonda yozgi vaqt yo'q). */
export function tashkentDay(iso: string): string {
  return new Date(Date.parse(iso) + 5 * 3_600_000).toISOString().slice(0, 10);
}

/** `date` + `years` yil; 29-fevral kirmagan yilda 28-fevral. */
export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y + years, m - 1, d));
  if (target.getUTCMonth() !== m - 1) target.setUTCDate(0); // oy oxiriga qaytarish
  return target.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function annualFeeStatus(input: {
  publishedAt: string | null;
  /** Qayd etilgan to'lovlar: sikl boshlanish kunlari (YYYY-MM-DD). */
  paidCycleStarts: readonly string[];
  /** Bugungi Toshkent kuni (YYYY-MM-DD). */
  today: string;
}): AnnualFeeStatus {
  const base = { amountUzs: ANNUAL_FEE_UZS };
  if (!input.publishedAt) {
    return { ...base, state: "unknown", referenceDate: null, dueDate: null, daysLeft: null };
  }

  const reference = tashkentDay(input.publishedAt);
  const paid = new Set(input.paidCycleStarts);

  // Bugungacha kelgan eng oxirgi yilliq kun (k >= 1).
  let k = 1;
  while (addYears(reference, k + 1) <= input.today) k += 1;
  const lastAnniversary = addYears(reference, k);

  if (lastAnniversary > input.today) {
    // Birinchi yilliq kun hali kelmagan.
    const days = daysBetween(input.today, lastAnniversary);
    return {
      ...base,
      state: days <= ANNUAL_FEE_WARN_DAYS ? "soon" : "upcoming",
      referenceDate: reference,
      dueDate: lastAnniversary,
      daysLeft: days,
    };
  }

  if (!paid.has(lastAnniversary)) {
    return {
      ...base,
      state: "overdue",
      referenceDate: reference,
      dueDate: lastAnniversary,
      daysLeft: -daysBetween(lastAnniversary, input.today),
    };
  }

  const next = addYears(reference, k + 1);
  const days = daysBetween(input.today, next);
  return {
    ...base,
    state: days <= ANNUAL_FEE_WARN_DAYS ? "soon" : "paid",
    referenceDate: reference,
    dueDate: next,
    daysLeft: days,
  };
}
