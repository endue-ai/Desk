// Dates and times in words, in the person's locale. Wall times are milliseconds as if local time were
// UTC, so they are formatted in UTC: the clock reads what the display zone reads.
import { DAY } from "./ical/values.js";

/**
 * @typedef {import("./calendar/model.js").Occurrence} Occurrence
 * @typedef {import("./calendar/layout.js").Mode} Mode
 */

/** @type {Map<string, Intl.DateTimeFormat>} */
const formats = new Map();

/**
 * @param {string} locale
 * @param {Intl.DateTimeFormatOptions} options
 */
const formatter = (locale, options) => {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
    formats.set(key, format);
  }
  return format;
};

/**
 * @param {string} locale
 * @param {number} wall
 * @param {Intl.DateTimeFormatOptions} options
 */
export const wallText = (locale, wall, options) =>
  formatter(locale, options).format(new Date(wall));

/** Whether a locale reads the clock in 24 hours, where hours take two digits (09:30). */
const clock24 = (/** @type {string} */ locale) => {
  const cycle = formatter(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
  return cycle === "h23" || cycle === "h24";
};

/** 09:30 or 9:30 AM, as the locale writes a time. */
export const timeText = (/** @type {string} */ locale, /** @type {number} */ wall) =>
  wallText(locale, wall, { hour: clock24(locale) ? "2-digit" : "numeric", minute: "2-digit" });

/** The heading of a view: "October 2026", "Oct 26 – Nov 1, 2026", "Friday, October 30, 2026". */
export function heading(
  /** @type {string} */ locale,
  /** @type {Mode} */ mode,
  /** @type {{ from: number, to: number }} */ span,
  /** @type {number} */ anchor,
) {
  if (mode === "month") return wallText(locale, anchor * DAY, { month: "long", year: "numeric" });
  if (mode === "day")
    return wallText(locale, anchor * DAY, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  const range = formatter(locale, { month: "short", day: "numeric", year: "numeric" });
  return range.formatRange(new Date(span.from * DAY), new Date((span.to - 1) * DAY));
}

/** A day as a heading in the agenda or a cell's name: "Friday, October 30". */
export const dayText = (/** @type {string} */ locale, /** @type {number} */ day) =>
  wallText(locale, day * DAY, { weekday: "long", month: "long", day: "numeric" });

/**
 * When an occurrence happens, in words: "All day", "09:00 – 10:00", "Oct 30, 22:00 – Oct 31, 01:00".
 * @param {string} locale
 * @param {Occurrence} occ
 */
export function whenText(locale, occ) {
  if (occ.allDay) {
    const days = Math.round((occ.endWall - occ.startWall) / DAY);
    if (days <= 1) return "All day";
    const last = occ.endWall - DAY;
    return `${wallText(locale, occ.startWall, { month: "short", day: "numeric" })} – ${wallText(locale, last, { month: "short", day: "numeric" })}`;
  }
  const sameDay =
    Math.floor(occ.startWall / DAY) === Math.floor(occ.endWall / DAY) ||
    (occ.endWall - occ.startWall < DAY && occ.endWall % DAY === 0);
  if (occ.endWall === occ.startWall) return timeText(locale, occ.startWall);
  if (sameDay) return `${timeText(locale, occ.startWall)} – ${timeText(locale, occ.endWall)}`;
  const hour = clock24(locale) ? "2-digit" : "numeric";
  const at = (/** @type {number} */ wall) =>
    wallText(locale, wall, { month: "short", day: "numeric", hour, minute: "2-digit" });
  return `${at(occ.startWall)} – ${at(occ.endWall)}`;
}

/**
 * An occurrence named in full, for screen readers and notifications: title, when, where.
 * @param {string} locale
 * @param {Occurrence} occ
 */
export function eventText(locale, occ) {
  const parts = [occ.title, whenText(locale, occ)];
  if (occ.location) parts.push(occ.location);
  if (occ.status === "CANCELLED") parts.push("cancelled");
  else if (occ.status === "TENTATIVE") parts.push("tentative");
  if (occ.recurring) parts.push("repeats");
  return parts.join(", ");
}
