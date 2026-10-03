import { parseCalendarDate, tashkentDayRangeForDate, tashkentToday } from "../tashkent-day.ts";

/**
 * ADMIN VIP BERADI — SANALARNI HISOBLASH. SOF MODUL.
 *
 * Admin formadan TOSHKENT kalendar sanasini tanlaydi ("2026-10-03"),
 * baza esa UTC lahzani saqlaydi. Bu yerdagi xato odamga to'lagan
 * kunini bermaydi yoki tekin kun beradi, shuning uchun hisob testdan
 * o'tadi va server amali ichida ko'milib qolmaydi.
 *
 * Faqat nisbiy `.ts` import: testlar `@/` ni ko'rmaydi.
 */

/** Formadagi tayyor muddatlar. */
export const VIP_PRESET_DAYS = [30, 90, 180, 365] as const;

/**
 * Eng uzun muddat — 10 yil.
 *
 * Tasodifan "3650" o'rniga "36500" yozilsa, amalda abadiy VIP paydo
 * bo'lardi va buni hech kim sezmasdi.
 */
export const VIP_MAX_DAYS = 3650;

const DAY_MS = 86_400_000;

export type GrantWindow =
  | { ok: true; startedAt: Date; periodEnd: Date; days: number }
  | { ok: false; error: string };

/**
 * Tugash sanasi — tanlangan kunning OXIRI (keyingi kun 00:00 Toshkent).
 *
 * "10-noyabrgacha" deganda odam 10-noyabr kuni ham VIP deb tushunadi.
 * Kun boshini olish undan bir kunni tortib olardi.
 */
export function endOfTashkentDay(date: string): Date | null {
  const parsed = parseCalendarDate(date);
  if (!parsed) return null;
  return new Date(tashkentDayRangeForDate(parsed).endIso);
}

function checkDays(days: number): string | null {
  if (!Number.isInteger(days) || days < 1) return "Muddat musbat butun kun bo'lsin.";
  if (days > VIP_MAX_DAYS) return `Muddat ${VIP_MAX_DAYS} kundan oshmasin.`;
  return null;
}

/**
 * VIP berish oynasi.
 *
 * Muddat IKKI xil beriladi — bittasi, ikkalasi emas:
 *   · `days`    — boshlanishdan N kun (30/90/180/365 yoki boshqa);
 *   · `endDate` — aniq sana (shu kun oxirigacha).
 *
 * BOSHLANISH KELAJAKDA BO'LMAYDI: huquq tekshiruvi `started_at` ga
 * qaramaydi, ya'ni kelajakdagi sana huquqni DARHOL berib qo'yardi.
 * O'tgan sana mumkin (to'lov oldinroq qilingan). Bugun tanlansa,
 * boshlanish — hozirgi lahza: kun boshi bo'lsa, odam tushdan keyin
 * to'lasa ham ertalabdan beri "VIP edi" bo'lib chiqardi.
 */
export function resolveGrantWindow(
  input: { startDate: string; days?: number | null; endDate?: string | null },
  now: Date,
): GrantWindow {
  const start = parseCalendarDate(input.startDate);
  if (!start) return { ok: false, error: "Boshlanish sanasi noto'g'ri." };

  const today = tashkentToday(now);
  if (start > today) return { ok: false, error: "Boshlanish sanasi kelajakda bo'lmasin." };

  const startedAt = start === today ? now : new Date(tashkentDayRangeForDate(start).startIso);

  const hasDays = input.days !== undefined && input.days !== null;
  const hasEnd = typeof input.endDate === "string" && input.endDate !== "";
  if (hasDays === hasEnd) {
    return { ok: false, error: "Muddatni yoki tugash sanasini tanlang (bittasini)." };
  }

  let periodEnd: Date;
  if (hasDays) {
    const problem = checkDays(input.days as number);
    if (problem) return { ok: false, error: problem };
    periodEnd = new Date(startedAt.getTime() + (input.days as number) * DAY_MS);
  } else {
    const end = endOfTashkentDay(input.endDate as string);
    if (!end) return { ok: false, error: "Tugash sanasi noto'g'ri." };
    periodEnd = end;
  }

  if (periodEnd.getTime() <= startedAt.getTime()) {
    return { ok: false, error: "Tugash sanasi boshlanishdan keyin bo'lishi kerak." };
  }
  if (periodEnd.getTime() <= now.getTime()) {
    return { ok: false, error: "Bu muddat allaqachon tugagan. Tugash sanasi kelajakda bo'lsin." };
  }

  const days = Math.ceil((periodEnd.getTime() - startedAt.getTime()) / DAY_MS);
  if (days > VIP_MAX_DAYS) return { ok: false, error: `Muddat ${VIP_MAX_DAYS} kundan oshmasin.` };

  return { ok: true, startedAt, periodEnd, days };
}

export type ExtensionInput =
  | { ok: true; kind: "days"; days: number }
  | { ok: true; kind: "date"; newEnd: Date }
  | { ok: false; error: string };

/** Uzaytirish: N kun yoki aniq sana (bittasi). */
export function resolveExtension(input: { days?: number | null; endDate?: string | null }): ExtensionInput {
  const hasDays = input.days !== undefined && input.days !== null;
  const hasEnd = typeof input.endDate === "string" && input.endDate !== "";
  if (hasDays === hasEnd) {
    return { ok: false, error: "Necha kunga yoki qaysi sanagacha uzaytirishni tanlang." };
  }

  if (hasDays) {
    const problem = checkDays(input.days as number);
    return problem ? { ok: false, error: problem } : { ok: true, kind: "days", days: input.days as number };
  }

  const end = endOfTashkentDay(input.endDate as string);
  return end ? { ok: true, kind: "date", newEnd: end } : { ok: false, error: "Tugash sanasi noto'g'ri." };
}
