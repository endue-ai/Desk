// Days and times for the universal views, in a named time zone without a date library: a day is its
// YYYY-MM-DD text, arithmetic on days runs in UTC (no zone can shift it), and an instant meets a day
// only through the zone's offset, which Intl reports.

/** The clock and the place a universal view draws in. */
export interface UniversalEnv {
  /** An IANA time zone; the system's when absent. */
  zone?: string;
  /** A BCP 47 language tag; the system's when absent. */
  locale?: string;
  /** Milliseconds since the epoch. */
  now: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();

/** One cached formatter per locale and options: building them is the slow part. */
export function formatter(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale ?? ""} ${JSON.stringify(options)}`;
  let found = formats.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, options);
    formats.set(key, found);
  }
  return found;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;

/** The wall-clock fields of an instant in a zone. */
function wall(at: number, zone: string | undefined): number[] {
  const parts = formatter("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return [
    field("year"),
    field("month"),
    field("day"),
    field("hour") % 24,
    field("minute"),
    field("second"),
  ];
}

/** How far the zone's clock is ahead of UTC at an instant, in milliseconds. */
export function offsetAt(at: number, zone?: string): number {
  const [y = 0, m = 1, d = 1, h = 0, min = 0, s = 0] = wall(at, zone);
  return Date.UTC(y, m - 1, d, h, min, s) - (at - (((at % 1000) + 1000) % 1000));
}

/** The instant a wall-clock time happens in a zone (the later one when a clock goes back). */
function instantOfWall(y: number, m: number, d: number, h = 0, min = 0, s = 0, zone?: string) {
  const guess = Date.UTC(y, m - 1, d, h, min, s);
  const first = guess - offsetAt(guess, zone);
  return guess - offsetAt(first, zone);
}

/** The day an instant falls on in a zone, as YYYY-MM-DD. */
export function dayOf(at: number, zone?: string): string {
  const [y = 0, m = 1, d = 1] = wall(at, zone);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The instant a day starts in a zone: its midnight. */
export function dayStart(day: string, zone?: string): number {
  const [, y = "0", m = "1", d = "1"] = DAY.exec(day) ?? [];
  return instantOfWall(Number(y), Number(m), Number(d), 0, 0, 0, zone);
}

const utc = (day: string) => {
  const [, y = "0", m = "1", d = "1"] = DAY.exec(day) ?? [];
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
};
const text = (date: Date) => date.toISOString().slice(0, 10);

/** The day `count` days after (or before) `day`. */
export function addDays(day: string, count: number): string {
  const date = utc(day);
  date.setUTCDate(date.getUTCDate() + count);
  return text(date);
}

/** The first day of the month `count` months after (or before) the month `day` is in. */
export function addMonths(day: string, count: number): string {
  const date = utc(day);
  return text(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1)));
}

/** The weekday of a day, Monday 0 to Sunday 6. */
export const weekdayOf = (day: string): number => (utc(day).getUTCDay() + 6) % 7;

/** The day's number in its month. */
export const dateOf = (day: string): number => utc(day).getUTCDate();

/** Whether a value is a whole day (YYYY-MM-DD). */
export const isDay = (value: string): boolean => DAY.test(value);

/**
 * When a value says: an RFC 3339 time with an offset, a wall-clock time without one (in the zone), or
 * a whole day (YYYY-MM-DD, from its midnight in the zone). Anything else is undefined.
 */
export function whenOf(value: unknown, zone?: string): { at: number; day?: string } | undefined {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? undefined : { at: value.getTime() };
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (DAY.test(trimmed)) {
    const at = dayStart(trimmed, zone);
    return Number.isNaN(at) || dayOf(at, zone) !== trimmed ? undefined : { at, day: trimmed };
  }
  if (OFFSET.test(trimmed)) {
    const at = Date.parse(trimmed);
    return Number.isNaN(at) ? undefined : { at };
  }
  const parts = WALL.exec(trimmed);
  if (!parts) return undefined;
  const [, y, m, d, h, min, s] = parts.map(Number);
  const at = instantOfWall(y ?? 0, m ?? 1, d ?? 1, h, min, s || 0, zone);
  return Number.isNaN(at) ? undefined : { at };
}

/** An instant's time of day in the zone: 09:05. */
export function timeText(at: number, env: Pick<UniversalEnv, "zone" | "locale">): string {
  const options = {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: env.zone,
  } as const;
  return formatter(env.locale, options).format(at);
}

/** A day as people read it: Wed, Nov 4 (with the year when it is not `thisYear`'s). */
export function dayLabel(
  day: string,
  env: Pick<UniversalEnv, "locale">,
  thisYear?: number,
): string {
  const date = utc(day);
  const year = thisYear !== undefined && date.getUTCFullYear() !== thisYear;
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(year ? { year: "numeric" } : {}),
  };
  return formatter(env.locale, options).format(date);
}

/** A month as people read it: November 2026. */
export function monthLabel(day: string, env: Pick<UniversalEnv, "locale">): string {
  const options = { month: "long", year: "numeric", timeZone: "UTC" } as const;
  return formatter(env.locale, options).format(utc(day));
}

/** The short weekday names, Monday first. */
export function weekdayNames(env: Pick<UniversalEnv, "locale">): string[] {
  const options = { weekday: "short", timeZone: "UTC" } as const;
  // 2024-01-01 was a Monday.
  return [0, 1, 2, 3, 4, 5, 6].map((i) =>
    formatter(env.locale, options).format(new Date(Date.UTC(2024, 0, 1 + i))),
  );
}

/** How long something took, roughly: 850 ms, 1.2 s, 3 min, 1 h 5 min. */
export function durationText(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(Math.round(ms / 100) / 10).toString()} s`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${minutes / 60} h`;
}
