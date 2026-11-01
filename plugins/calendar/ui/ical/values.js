// iCalendar value types (RFC 5545 §3.3): DATE, DATE-TIME, DURATION, PERIOD and UTC-OFFSET, and the
// wall-clock arithmetic the rest of the plugin does on them. A wall time is a count of milliseconds
// as if the local date and time were UTC: days and hours add without any time zone, and a zone turns
// it into an instant only at the end (zones.js).

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const MINUTE = 60_000;

/**
 * A DATE (`date: true`) or a DATE-TIME. A DATE-TIME is in UTC (`utc`), in the zone `tzid` names, or
 * floating (neither): the same wall time wherever it is read.
 * @typedef {{ date: true, y: number, m: number, d: number }} DateValue
 * @typedef {{ date: false, y: number, m: number, d: number, h: number, mi: number, s: number,
 *   utc: boolean, tzid?: string }} DateTimeValue
 * @typedef {DateValue | DateTimeValue} TimeValue
 * @typedef {{ sign: 1 | -1, weeks: number, days: number, hours: number, minutes: number,
 *   seconds: number }} Duration
 */

/**
 * The day number (days since 1970-01-01) of a calendar date. Months and days out of range roll
 * over (month 13 is January of the next year). setUTCFullYear, unlike Date.UTC, keeps years 0-99.
 * @param {number} y
 * @param {number} m
 * @param {number} d
 */
export const dayNumber = (y, m, d) => Math.floor(new Date(0).setUTCFullYear(y, m - 1, d) / DAY);

/** The calendar date of a day number. */
export const ymd = (/** @type {number} */ day) => {
  const date = new Date(day * DAY);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
};

/** 0 for Sunday to 6 for Saturday, as BYDAY's SU..SA. */
export const weekday = (/** @type {number} */ day) => (((day + 4) % 7) + 7) % 7;

export const isLeap = (/** @type {number} */ y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export const daysInMonth = (/** @type {number} */ y, /** @type {number} */ m) =>
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
  const [y, m, d] = [match[1], match[2], match[3]].map(Number);
  if (y === undefined || m === undefined || d === undefined) return undefined;
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return undefined;
  if (match[4] === undefined) return { date: true, y, m, d };
  const [h, mi, s] = [match[4], match[5], match[6]].map(Number);
  if (h === undefined || mi === undefined || s === undefined) return undefined;
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

const pad = (/** @type {number} */ n, size = 2) => String(n).padStart(size, "0");

/**
 * Format a value as iCalendar writes it: 19970714, 19970714T133000 or 19970714T133000Z.
 * @param {TimeValue} value
 */
export function formatTime(value) {
  const date = `${pad(value.y, 4)}${pad(value.m)}${pad(value.d)}`;
  if (value.date) return date;
  return `${date}T${pad(value.h)}${pad(value.mi)}${pad(value.s)}${value.utc ? "Z" : ""}`;
}

/**
 * The wall time of a value, in milliseconds.
 * @param {TimeValue} value
 */
export function wallOf(value) {
  const day = dayNumber(value.y, value.m, value.d);
  if (value.date) return day * DAY;
  return day * DAY + ((value.h * 60 + value.mi) * 60 + value.s) * 1000;
}

/**
 * A value at a wall time, with the kind (DATE, UTC, TZID, floating) of `like`.
 * @param {number} wall
 * @param {TimeValue} like
 * @returns {TimeValue}
 */
export function timeAt(wall, like) {
  const day = Math.floor(wall / DAY);
  const { y, m, d } = ymd(day);
  if (like.date) return { date: true, y, m, d };
  const seconds = Math.floor((wall - day * DAY) / 1000);
  const time = {
    h: Math.floor(seconds / 3600),
    mi: Math.floor(seconds / 60) % 60,
    s: seconds % 60,
  };
  return {
    date: false,
    y,
    m,
    d,
    ...time,
    utc: like.utc,
    ...(like.tzid ? { tzid: like.tzid } : {}),
  };
}

/**
 * Parse a DURATION (§3.3.6): P15DT5H0M20S, P7W, -PT15M. Undefined when malformed.
 * @param {string} text
 * @returns {Duration | undefined}
 */
export function parseDuration(text) {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    text.trim(),
  );
  if (!match || /^[+-]?PT?$/.test(text.trim())) return undefined;
  const n = (/** @type {string | undefined} */ part) => (part ? Number(part) : 0);
  return {
    sign: match[1] === "-" ? -1 : 1,
    weeks: n(match[2]),
    days: n(match[3]),
    hours: n(match[4]),
    minutes: n(match[5]),
    seconds: n(match[6]),
  };
}

/**
 * Format a duration in its shortest form; a zero duration is PT0S.
 * @param {Duration} duration
 */
export function formatDuration(duration) {
  const { sign, weeks, days, hours, minutes, seconds } = duration;
  const lead = sign < 0 ? "-P" : "P";
  if (weeks && !days && !hours && !minutes && !seconds) return `${lead}${weeks}W`;
  const allDays = weeks * 7 + days;
  const time = `${hours ? `${hours}H` : ""}${minutes ? `${minutes}M` : ""}${seconds ? `${seconds}S` : ""}`;
  if (!allDays && !time) return "PT0S";
  return `${lead}${allDays ? `${allDays}D` : ""}${time ? `T${time}` : ""}`;
}

/**
 * The nominal part of a duration (weeks and days, which follow the wall clock across a time change)
 * and its exact part (hours, minutes and seconds), both in milliseconds and signed (§3.3.6).
 * @param {Duration} duration
 */
export const durationParts = (duration) => ({
  nominal: duration.sign * (duration.weeks * 7 + duration.days) * DAY,
  exact: duration.sign * ((duration.hours * 60 + duration.minutes) * 60 + duration.seconds) * 1000,
});

/**
 * A duration from a signed count of milliseconds: whole days as days, the rest as time.
 * @param {number} ms
 * @param {boolean} [nominalDays] write whole days as D; otherwise everything is hours and less
 * @returns {Duration}
 */
export function durationOf(ms, nominalDays = true) {
  const sign = ms < 0 ? -1 : 1;
  let rest = Math.round(Math.abs(ms) / 1000);
  const days = nominalDays ? Math.floor(rest / 86400) : 0;
  rest -= days * 86400;
  const hours = Math.floor(rest / 3600);
  const minutes = Math.floor(rest / 60) % 60;
  return { sign, weeks: 0, days, hours, minutes, seconds: rest % 60 };
}

/**
 * Parse a UTC-OFFSET (+0530, -0800, +013045) into milliseconds; undefined when malformed.
 * @param {string} text
 */
export function parseOffset(text) {
  const match = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(text.trim());
  if (!match) return undefined;
  const ms = ((Number(match[2]) * 60 + Number(match[3])) * 60 + Number(match[4] ?? 0)) * 1000;
  return match[1] === "-" ? -ms : ms;
}

/**
 * Format milliseconds as a UTC-OFFSET; -0000 is never written (§3.3.14).
 * @param {number} ms
 */
export function formatOffset(ms) {
  const total = Math.round(Math.abs(ms) / 1000);
  const seconds = total % 60;
  return `${ms < 0 ? "-" : "+"}${pad(Math.floor(total / 3600))}${pad(Math.floor(total / 60) % 60)}${seconds ? pad(seconds) : ""}`;
}

/**
 * An instant as an RFC 3339 string at a given UTC offset: 2026-10-30T09:00:00+09:00.
 * @param {number} utc
 * @param {number} offset in milliseconds
 */
export function rfc3339(utc, offset) {
  const wall = new Date(utc + offset);
  const date = `${pad(wall.getUTCFullYear(), 4)}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`;
  const time = `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}`;
  if (offset === 0) return `${date}T${time}Z`;
  const minutes = Math.round(Math.abs(offset) / MINUTE);
  return `${date}T${time}${offset < 0 ? "-" : "+"}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
