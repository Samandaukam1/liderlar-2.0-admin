/**
 * "Bugun" — Asia/Tashkent bo'yicha.
 *
 * Serverning o'zi UTC'da ishlaydi, shuning uchun `new Date().toDateString()`
 * kabi hisob soat 19:00 dan keyin (Toshkent 00:00) ertangi kunga o'tib ketadi
 * va kunlik ro'yxat noto'g'ri chiqadi. Bu yerdagi funksiyalar kun chegarasini
 * ALWAYS zona bo'yicha hisoblaydi va UTC instant sifatida qaytaradi — natijani
 * to'g'ridan-to'g'ri `gte`/`lt` query'ga berish mumkin.
 *
 * Pure module: no I/O, client + server uchun xavfsiz, test qilinadigan.
 */

export const TASHKENT_TZ = "Asia/Tashkent";

const PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: TASHKENT_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The zone's wall-clock reading of a given instant. */
function wallClockAt(instant: Date): WallClock {
  const parts = PARTS_FORMATTER.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * How far the zone sits ahead of UTC at this instant, in minutes.
 *
 * Derived rather than hardcoded to +05:00: Tashkent has had no DST since 1992,
 * but reading it from the IANA database means a future rule change is picked up
 * by a Node update instead of silently shifting every daily report by an hour.
 */
export function tashkentOffsetMinutes(instant: Date = new Date()): number {
  const wall = wallClockAt(instant);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  // Sub-second precision is irrelevant to an offset; rounding to the minute
  // keeps the result exact for every real-world zone. `instant` is read, never
  // mutated — an in-place setMilliseconds here would corrupt the caller's Date.
  return Math.round((asUtc - instant.getTime()) / 60000);
}

export interface DayRange {
  /** Inclusive lower bound (00:00:00 Tashkent) as a UTC ISO string. */
  startIso: string;
  /** EXCLUSIVE upper bound (next day 00:00:00 Tashkent) as a UTC ISO string. */
  endIso: string;
  /** The Tashkent calendar date the range covers, as YYYY-MM-DD. */
  date: string;
}

/**
 * The UTC instants bounding the Tashkent calendar day that contains `now`.
 *
 * The upper bound is EXCLUSIVE: query with `.gte(start).lt(end)` so a row
 * stamped exactly at midnight belongs to one day only, never to both.
 */
export function tashkentDayRange(now: Date = new Date()): DayRange {
  const wall = wallClockAt(now);
  const offsetMinutes = tashkentOffsetMinutes(now);
  const startUtcMs =
    Date.UTC(wall.year, wall.month - 1, wall.day, 0, 0, 0) - offsetMinutes * 60000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;

  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    startIso: new Date(startUtcMs).toISOString(),
    endIso: new Date(endUtcMs).toISOString(),
    date: `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`,
  };
}

/** Tashkent wall-clock hour (0-23) of an instant — used for quiet hours. */
export function tashkentHour(instant: Date = new Date()): number {
  return wallClockAt(instant).hour;
}

/** `dd.MM.yyyy HH:mm` in Tashkent time, for admin tables and bot messages. */
export function formatTashkent(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const w = wallClockAt(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(w.day)}.${pad(w.month)}.${w.year} ${pad(w.hour)}:${pad(w.minute)}`;
}
