// An items source's query with its placeholders filled (ADR 0103): `{now}`, `{today}`, `{tomorrow}`
// and `{yesterday}` are the clock as RFC 3339 instants in the view's zone, as in item views (ADR
// 0032); `{params.<name>}` is a value the opener gave. Only strings in `where` values are filled;
// a string that is one placeholder keeps the value's type.
import type { ItemQuery } from "@endue-ai/bridge";

export interface ClockEnv {
  /** Milliseconds since the epoch. */
  now: number;
  /** An IANA zone; the system's when absent. */
  zone?: string;
  params?: Record<string, unknown>;
}

const two = (n: number) => String(n).padStart(2, "0");

/** The wall clock of an instant in a zone, and the zone's offset from UTC in minutes then. */
function wall(ms: number, zone?: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(ms)
      .map((part) => [part.type, part.value]),
  );
  const n = (name: string) => Number(parts[name]);
  const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  const offset = Math.round((local - Math.floor(ms / 1000) * 1000) / 60_000);
  return {
    year: n("year"),
    month: n("month"),
    day: n("day"),
    hour: n("hour"),
    minute: n("minute"),
    second: n("second"),
    offset,
  };
}

/** An instant as RFC 3339 with the zone's offset. */
export function rfc3339(ms: number, zone?: string): string {
  const w = wall(ms, zone);
  const sign = w.offset < 0 ? "-" : "+";
  const abs = Math.abs(w.offset);
  return `${w.year}-${two(w.month)}-${two(w.day)}T${two(w.hour)}:${two(w.minute)}:${two(w.second)}${sign}${two(Math.trunc(abs / 60))}:${two(abs % 60)}`;
}

/** The midnight that starts the day `days` from the day of `ms`, in a zone. */
function dayStart(ms: number, zone: string | undefined, days: number): number {
  const w = wall(ms, zone);
  const midnight = Date.UTC(w.year, w.month - 1, w.day + days);
  let guess = midnight - w.offset * 60_000;
  guess = midnight - wall(guess, zone).offset * 60_000;
  return guess;
}

/** The clock's names in a zone. */
export function clockOf(now: number, zone?: string): Record<string, string> {
  return {
    now: rfc3339(now, zone),
    today: rfc3339(dayStart(now, zone, 0), zone),
    tomorrow: rfc3339(dayStart(now, zone, 1), zone),
    yesterday: rfc3339(dayStart(now, zone, -1), zone),
  };
}

const ALONE = /^\{([A-Za-z_][A-Za-z0-9_.-]*)\}$/;
const ANY = /\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g;

/** A query with its where values' placeholders filled; unknown placeholders stay as written. */
export function fillQuery(query: ItemQuery, env: ClockEnv): ItemQuery {
  if (!query.where?.length) return query;
  const clock = clockOf(env.now, env.zone);
  const lookup = (name: string): unknown =>
    name.startsWith("params.") ? env.params?.[name.slice("params.".length)] : clock[name];
  const fill = (value: unknown): unknown => {
    if (typeof value !== "string") return Array.isArray(value) ? value.map(fill) : value;
    const alone = ALONE.exec(value);
    if (alone) {
      const found = lookup(alone[1] ?? "");
      return found === undefined ? value : found;
    }
    return value.replace(ANY, (match, name: string) => {
      const found = lookup(name);
      return found === undefined ? match : String(found);
    });
  };
  return {
    ...query,
    where: query.where.map((condition) =>
      "value" in condition ? { ...condition, value: fill(condition.value) } : condition,
    ),
  };
}
