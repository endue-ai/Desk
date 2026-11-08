// VTIMEZONE components for IANA zones (RFC 5545 §3.6.5), so other apps read a TZID this plugin writes.
// The platform has no rule tables, only offsets: the changes of a year are found by search, and a
// change that falls on the same weekday of the same week each year becomes a yearly RRULE
// (2SU in March, -1SU in October). Anything else is listed year by year with RDATE.
import { WEEKDAYS } from "./rrule.js";
import {
  DAY,
  dayNumber,
  daysInMonth,
  formatOffset,
  formatTime,
  timeAt,
  weekday,
} from "./values.js";

/**
 * @typedef {import("./zones.js").Zone} Zone
 * @typedef {import("./component.js").Component} Component
 * @typedef {{ at: number, from: number, to: number }} Change
 */

/** Years listed one by one when a zone's changes follow no yearly rule. */
const LISTED_YEARS = 20;
/** Years a yearly rule is checked against. */
const CHECKED_YEARS = 5;

/** A floating DATE-TIME, as observances write their local onset. */
const LOCAL = /** @type {const} */ ({
  date: false,
  y: 0,
  m: 0,
  d: 0,
  h: 0,
  mi: 0,
  s: 0,
  utc: false,
});
const local = (/** @type {number} */ wall) => formatTime(timeAt(wall, LOCAL));

/**
 * The offset changes of a zone in [from, to), found day by day and narrowed to the second.
 * @param {Zone} zone
 * @param {number} from
 * @param {number} to
 * @returns {Change[]}
 */
export function changes(zone, from, to) {
  /** @type {Change[]} */
  const found = [];
  let before = zone.offset(from);
  for (let at = from; at < to; at += DAY / 2) {
    const next = Math.min(at + DAY / 2, to);
    const after = zone.offset(next);
    if (after === before) continue;
    let lo = at;
    let hi = next;
    while (hi - lo > 1000) {
      const mid = Math.floor((lo + hi) / 2000) * 1000;
      if (zone.offset(mid) === before) lo = mid;
      else hi = mid;
    }
    found.push({ at: hi, from: before, to: after });
    before = after;
  }
  return found;
}

/**
 * How a change sits in its month, in local time before it: the week (1-4, or -1 for the last) and
 * the weekday, the month, and the time of day.
 * @param {Change} change
 */
const shape = (change) => {
  const wall = change.at + change.from;
  const day = Math.floor(wall / DAY);
  const date = new Date(day * DAY);
  const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  const last = d + 7 > daysInMonth(y, m);
  return { wall, m, wd: weekday(day), week: Math.ceil(d / 7), last, time: wall - day * DAY };
};

/**
 * The day in year `y` that the n-th (or last, -1) weekday `wd` of month `m` falls on.
 * @param {number} y @param {number} m @param {number} n @param {number} wd
 */
const nthWeekday = (y, m, n, wd) => {
  if (n > 0) {
    const first = dayNumber(y, m, 1);
    return first + ((wd - weekday(first) + 7) % 7) + (n - 1) * 7;
  }
  const end = dayNumber(y, m, daysInMonth(y, m));
  return end - ((weekday(end) - wd + 7) % 7);
};

/**
 * A VTIMEZONE for an IANA zone, with rules that hold from `year` on.
 * @param {Zone} zone
 * @param {number} year
 * @param {string} [tzid] the TZID events write, when it is an alias of the zone's own name
 * @returns {Component}
 */
export function vtimezoneFor(zone, year, tzid = zone.id) {
  const start = dayNumber(year, 1, 1) * DAY;
  const span = changes(zone, start, dayNumber(year + CHECKED_YEARS, 1, 1) * DAY);
  const id = { name: "TZID", params: {}, value: tzid };
  if (span.length === 0) {
    const offset = formatOffset(zone.offset(start));
    return {
      name: "VTIMEZONE",
      props: [id],
      components: [observance("STANDARD", "19700101T000000", offset, offset, [])],
    };
  }
  const first = span.filter((c) => c.at < dayNumber(year + 1, 1, 1) * DAY);
  /** @type {Component[]} */
  const observances = [];
  for (const change of first) {
    const { wall, m, wd, week, last, time } = shape(change);
    const name = change.to > change.from ? "DAYLIGHT" : "STANDARD";
    const later = span.filter((c) => c.from === change.from && c.to === change.to && c !== change);
    // A rule holds when the next years change on the same weekday of the same week, at the same time.
    const holds = (/** @type {number} */ n) =>
      later.length >= CHECKED_YEARS - 2 &&
      later.every((c) => {
        const y = new Date(c.at + c.from).getUTCFullYear();
        return nthWeekday(y, m, n, wd) * DAY + time === c.at + c.from;
      });
    // "Last" first: the last Sunday of March is the 4th in some years and the 5th in others.
    const n = last && holds(-1) ? -1 : holds(week) ? week : 0;
    const from = formatOffset(change.from);
    const to = formatOffset(change.to);
    const dtstart = local(wall);
    if (n !== 0) {
      const value = `FREQ=YEARLY;BYMONTH=${m};BYDAY=${n}${WEEKDAYS[wd]}`;
      const rrule = { name: "RRULE", params: {}, value };
      observances.push(observance(name, dtstart, from, to, [rrule]));
      continue;
    }
    const listed = changes(zone, change.at, dayNumber(year + LISTED_YEARS, 1, 1) * DAY)
      .filter((c) => c.from === change.from && c.to === change.to && c.at !== change.at)
      .map((c) => local(c.at + c.from));
    const rdates = listed.length ? [{ name: "RDATE", params: {}, value: listed.join(",") }] : [];
    observances.push(observance(name, dtstart, from, to, rdates));
  }
  return { name: "VTIMEZONE", props: [id], components: observances };
}

/**
 * @param {string} name STANDARD or DAYLIGHT
 * @param {string} dtstart
 * @param {string} from
 * @param {string} to
 * @param {import("./lines.js").Prop[]} more
 * @returns {Component}
 */
const observance = (name, dtstart, from, to, more) => ({
  name,
  props: [
    { name: "DTSTART", params: {}, value: dtstart },
    { name: "TZOFFSETFROM", params: {}, value: from },
    { name: "TZOFFSETTO", params: {}, value: to },
    ...more,
  ],
  components: [],
});
