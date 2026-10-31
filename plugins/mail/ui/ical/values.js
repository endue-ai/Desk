// iCalendar value types the mail plugin reads (RFC 5545 §3.3): DATE, DATE-TIME (UTC, in a zone, or
// floating), DURATION and UTC-OFFSET, and the zones a TZID names. A wall time is a count of
// milliseconds as if the local date and time were UTC; a zone turns it into an instant at the end,
// through the Intl API, so the plugin ships no zone table.

export const DAY = 86_400_000;

/**
 * A DATE (`date: true`) or a DATE-TIME: in UTC (`utc`), in the zone `tzid` names, or floating.
 * @typedef {{ date: true, y: number, m: number, d: number }} DateValue
 * @typedef {{ date: false, y: number, m: number, d: number, h: number, mi: number, s: number,
 *   utc: boolean, tzid?: string }} DateTimeValue
 * @typedef {DateValue | DateTimeValue} TimeValue
 * @typedef {{ tz?: string, offset?: number, approximate: boolean }} Zone
 * A zone a TZID resolved to: an IANA name, or a fixed offset read off a VTIMEZONE (approximate).
 * @typedef {{ wall: number, utc?: number, allDay: boolean, zone?: string, floating: boolean,
 *   approximate: boolean }} When
 * A moment as the plugin shows it: the wall time where it was written, the instant when there is
 * one (never for a floating time or a date), and the zone it was written in.
 */

const pad = (/** @type {number} */ n, size = 2) => String(n).padStart(size, "0");

/** The day number (days since 1970-01-01) of a calendar date; out-of-range days roll over. */
const dayNumber = (/** @type {number} */ y, /** @type {number} */ m, /** @type {number} */ d) =>
  Math.floor(new Date(0).setUTCFullYear(y, m - 1, d) / DAY);

const isLeap = (/** @type {number} */ y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (/** @type {number} */ y, /** @type {number} */ m) =>
  [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 30;

/**
 * Parse a DATE (19970714) or DATE-TIME (19970714T133000, ...Z) value; undefined when malformed.
 * @param {string} text
 * @param {string} [tzid] the TZID parameter, kept on a DATE-TIME that is not UTC
 * @returns {TimeValue | undefined}
 */
export function parseTime(text, tzid) {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(text.trim());
  if (!match) return undefined;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return undefined;
  if (match[4] === undefined) return { date: true, y, m, d };
  const [h, mi, s] = [Number(match[4]), Number(match[5]), Number(match[6])];
  // A leap second (60) is read as the last second of the minute.
  if (h > 23 || mi > 59 || s > 60) return undefined;
  const utc = match[7] === "Z";
  return {
    date: false,
    y,
    m,
    d,
    h,
    mi,
    s: Math.min(s, 59),
    utc,
    ...(!utc && tzid ? { tzid } : {}),
  };
}

/**
 * Format a value as iCalendar writes it: 19970714, 19970714T133000 or 19970714T133000Z.
 * @param {TimeValue} value
 */
export function formatTime(value) {
  const date = `${pad(value.y, 4)}${pad(value.m)}${pad(value.d)}`;
  if (value.date) return date;
  return `${date}T${pad(value.h)}${pad(value.mi)}${pad(value.s)}${value.utc ? "Z" : ""}`;
}

/** The wall time of a value, in milliseconds. @param {TimeValue} value */
export function wallOf(value) {
  const day = dayNumber(value.y, value.m, value.d);
  if (value.date) return day * DAY;
  return day * DAY + ((value.h * 60 + value.mi) * 60 + value.s) * 1000;
}

/** A UTC DATE-TIME value for an instant. @param {number} utc */
export function utcValue(utc) {
  const date = new Date(utc);
  return {
    date: false,
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
    h: date.getUTCHours(),
    mi: date.getUTCMinutes(),
    s: date.getUTCSeconds(),
    utc: true,
  };
}

/**
 * Parse a DURATION (P1DT2H30M, -PT15M, P2W) into milliseconds; undefined when malformed. Days and
 * weeks count as 24 hours each, which is exact on a wall clock.
 * @param {string} text
 */
export function parseDuration(text) {
  const match = /^([+-])?P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/.exec(
    text.trim(),
  );
  if (!match || text.trim().endsWith("T")) return undefined;
  const [, sign, w, d, h, mi, s] = match;
  const n = (/** @type {string | undefined} */ v) => Number(v ?? 0);
  const ms = n(w) * 7 * DAY + n(d) * DAY + n(h) * 3_600_000 + n(mi) * 60_000 + n(s) * 1000;
  if (ms === 0 && !/\d/.test(text)) return undefined;
  return sign === "-" ? -ms : ms;
}

/** Parse a UTC-OFFSET (+0900, -0530, +003000) into milliseconds; undefined when malformed. */
export function parseOffset(text) {
  const match = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(text.trim());
  if (!match) return undefined;
  const ms = (Number(match[2]) * 60 + Number(match[3])) * 60_000 + Number(match[4] ?? 0) * 1000;
  return match[1] === "-" ? -ms : ms;
}

/** Whether the Intl API knows a zone by this name. @param {string} name */
export function isZone(name) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** @type {Map<string, Intl.DateTimeFormat>} */
const formats = new Map();
const formatFor = (/** @type {string} */ tz) => {
  let format = formats.get(tz);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formats.set(tz, format);
  }
  return format;
};

/**
 * The offset of a zone at an instant, in milliseconds east of UTC.
 * @param {string} tz an IANA zone
 * @param {number} utc
 */
export function offsetAt(tz, utc) {
  const parts = Object.fromEntries(
    formatFor(tz)
      .formatToParts(new Date(utc))
      .map((p) => [p.type, Number(p.value)]),
  );
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return wall - Math.floor(utc / 1000) * 1000;
}

/**
 * The instant of a wall time in a zone. A wall time a transition repeats (autumn) is read in the
 * earlier offset; one a transition skipped (spring) is read with the offset in force before the
 * gap, as RFC 5545 §3.3.5 says (02:30 becomes 03:30 summer time).
 * @param {number} wall
 * @param {string} tz
 */
export function toUtc(wall, tz) {
  const offsets = new Set([offsetAt(tz, wall - DAY), offsetAt(tz, wall), offsetAt(tz, wall + DAY)]);
  const valid = [...offsets].map((o) => wall - o).filter((utc) => offsetAt(tz, utc) === wall - utc);
  if (valid.length > 0) return Math.min(...valid);
  return wall - offsetAt(tz, wall - DAY);
}

/** The wall time of an instant in a zone. */
export const toWall = (/** @type {number} */ utc, /** @type {string} */ tz) =>
  utc + offsetAt(tz, utc);

/** The zone this code runs in. */
export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Format an instant as RFC 3339 with an offset: 2026-10-30T16:00:00+09:00.
 * @param {number} utc
 * @param {number} offset in milliseconds
 */
export function rfc3339(utc, offset) {
  const v = utcValue(utc + offset);
  const base = `${pad(v.y, 4)}-${pad(v.m)}-${pad(v.d)}T${pad(v.h)}:${pad(v.mi)}:${pad(v.s)}`;
  if (offset === 0) return `${base}Z`;
  const abs = Math.abs(offset) / 60_000;
  return `${base}${offset < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Resolve a TZID: an IANA name the Intl API knows; a name ending in one (Olson paths like
 * /mozilla.org/20050126_1/Europe/Berlin); a VTIMEZONE's X-LIC-LOCATION; or, failing all, the
 * standard offset of its VTIMEZONE, marked approximate. Undefined when nothing is known.
 * @param {string} tzid
 * @param {Array<{ tzid: string, location?: string, standardOffset?: number }>} vtimezones
 * @returns {Zone | undefined}
 */
export function resolveZone(tzid, vtimezones = []) {
  if (isZone(tzid)) return { tz: tzid, approximate: false };
  const parts = tzid.split("/").filter(Boolean);
  for (let from = Math.max(0, parts.length - 3); from < parts.length - 1; from++) {
    const tail = parts.slice(from).join("/");
    if (isZone(tail)) return { tz: tail, approximate: false };
  }
  const own = vtimezones.find((z) => z.tzid === tzid);
  if (own?.location && isZone(own.location)) return { tz: own.location, approximate: false };
  if (own?.standardOffset !== undefined) return { offset: own.standardOffset, approximate: true };
  return undefined;
}

/**
 * When a value is: its wall time, its instant when the value has one, the zone it was written in.
 * A floating time is shown as a wall time in the person's zone, as §3.3.5 asks, and said so.
 * @param {TimeValue} value
 * @param {(tzid: string) => Zone | undefined} zoneOf
 * @param {string} local the person's zone
 * @returns {When}
 */
export function whenOf(value, zoneOf, local) {
  const wall = wallOf(value);
  if (value.date) return { wall, allDay: true, floating: false, approximate: false };
  if (value.utc)
    return { wall, utc: wall, allDay: false, zone: "UTC", floating: false, approximate: false };
  const zone = value.tzid ? zoneOf(value.tzid) : undefined;
  if (zone?.tz)
    return {
      wall,
      utc: toUtc(wall, zone.tz),
      allDay: false,
      zone: zone.tz,
      floating: false,
      approximate: false,
    };
  if (zone?.offset !== undefined)
    return {
      wall,
      utc: wall - zone.offset,
      allDay: false,
      zone: value.tzid,
      floating: false,
      approximate: true,
    };
  return {
    wall,
    utc: toUtc(wall, local),
    allDay: false,
    zone: local,
    floating: true,
    approximate: false,
  };
}
