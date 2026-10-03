/**
 * KUNLIK PREMIUM CHALLENGE — QOIDALAR. SOF MODUL.
 *
 * Bazadagi `finalize_daily_challenge()` bilan BIR XIL: 1 -> 30, 2 -> 20,
 * 3 -> 10 kun. Bu yerda kechiktirilgan sovrin va xabarnoma matni uchun.
 * Faqat nisbiy `.ts` import — testlar `@/` ni ko'rmaydi.
 */

import { tashkentDayRangeForDate } from "../tashkent-day.ts";

export const CHALLENGE_REWARD_DAYS: Readonly<Record<number, number>> = { 1: 30, 2: 20, 3: 10 };

/** Bellashuv oynasi, Asia/Tashkent: [09:00, 19:00). */
export const CHALLENGE_START_HOUR = 9;
export const CHALLENGE_END_HOUR = 19;

export function challengeRewardDays(position: number): number {
  return CHALLENGE_REWARD_DAYS[position] ?? 0;
}

export function challengeWinnerMessage(place: number, days: number): { title: string; body: string; link: string } {
  return {
    title: `Tabriklaymiz! Premium Challenge — ${place}-o'rin`,
    body:
      `Bugungi Kunlik Premium Challenge'da ${place}-o'rinni egalladingiz. ` +
      `VIP obunangizga ${days} kun qo'shildi.`,
    link: "/kabinet",
  };
}

const HOUR_MS = 3_600_000;

/** Kun oynasi tugaganmi (19:00 Asia/Tashkent). */
export function challengeEnded(date: string, now: Date): boolean {
  const dayStart = new Date(tashkentDayRangeForDate(date).startIso).getTime();
  return now.getTime() >= dayStart + CHALLENGE_END_HOUR * HOUR_MS;
}

/** Bellashuv oynasi (UTC lahzalar): [09:00, 19:00) Toshkent. */
export function challengeWindow(date: string): { startsAt: Date; endsAt: Date } {
  const dayStart = new Date(tashkentDayRangeForDate(date).startIso).getTime();
  return {
    startsAt: new Date(dayStart + CHALLENGE_START_HOUR * HOUR_MS),
    endsAt: new Date(dayStart + CHALLENGE_END_HOUR * HOUR_MS),
  };
}
