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
  const pad = (n: number) => String(n).padStart(2, "0");
  return tashkentDayRangeForDate(`${wall.year}-${pad(wall.month)}-${pad(wall.day)}`);
}

/** YYYY-MM-DD, or null when the text is not a real calendar date. */
export function parseCalendarDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Round-tripping rejects the dates that pass the shape check but do not
  // exist — 2026-02-30 would otherwise silently become 2026-03-02.
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
    ? value
    : null;
}

/**
 * The UTC instants bounding one Tashkent calendar date.
 *
 * Takes the date rather than an instant, so the board can show any day the
 * admin picks — not only the one the server happens to be inside. The offset is
 * read at midday of that date: a zone that ever gained DST would shift its
 * midnights, and midday is the point furthest from either edge.
 */
export function tashkentDayRangeForDate(date: string): DayRange {
  const [year, month, day] = date.split("-").map(Number);
  const middayUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offsetMinutes = tashkentOffsetMinutes(middayUtc);

  const startUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMinutes * 60000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;

  return {
    startIso: new Date(startUtcMs).toISOString(),
    endIso: new Date(endUtcMs).toISOString(),
    date,
  };
}

/** Today's Tashkent calendar date as YYYY-MM-DD. */
export function tashkentToday(now: Date = new Date()): string {
  const wall = wallClockAt(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** The calendar date `days` before or after `date`, staying in the zone. */
export function shiftCalendarDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
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
