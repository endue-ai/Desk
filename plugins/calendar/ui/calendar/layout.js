// What each view shows, without the DOM: the days of a month grid, the columns of a week or a day
// with overlapping events side by side, and the days of the agenda. Everything is in wall time of the
// display zone, as day numbers (days since 1970-01-01) and milliseconds.
import { DAY, dayNumber, daysInMonth, MINUTE, weekday, ymd } from "../ical/values.js";

/**
 * @typedef {import("./model.js").Occurrence} Occurrence
 * @typedef {"month" | "week" | "day" | "agenda"} Mode
 * @typedef {{ occ: Occurrence, top: number, height: number, col: number, cols: number,
 *   continues: boolean, continued: boolean }} Block a timed event in a day column, in minutes
 */

export const MODES = /** @type {const} */ (["month", "week", "day", "agenda"]);

/** Days the agenda lists from its first day. */
export const AGENDA_DAYS = 30;

/** The shortest an event is drawn in a day column, in minutes, so it can be read and clicked. */
const SHORTEST = 20;

/**
 * The first day of the week by locale: 0 for Sunday to 6 for Saturday.
 * @param {string} locale
 */
export function localeWeekStart(locale) {
  try {
    const info =
      /** @type {{ getWeekInfo?: () => { firstDay: number }, weekInfo?: { firstDay: number } }} */ (
        /** @type {unknown} */ (new Intl.Locale(locale))
      );
    const first = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    return first === undefined ? 1 : first % 7;
  } catch {
    return 1;
  }
}

/** The first day of the week holding `day`. */
export const weekOf = (/** @type {number} */ day, /** @type {number} */ start) =>
  day - ((weekday(day) - start + 7) % 7);

/**
 * The days a view shows, [from, to) as day numbers.
 * @param {Mode} mode
 * @param {number} anchor the day the view is about
 * @param {number} weekStart
 */
export function span(mode, anchor, weekStart) {
  if (mode === "month") {
    const { y, m } = ymd(anchor);
    const from = weekOf(dayNumber(y, m, 1), weekStart);
    return { from, to: from + 42 };
  }
  if (mode === "week") {
    const from = weekOf(anchor, weekStart);
    return { from, to: from + 7 };
  }
  if (mode === "day") return { from: anchor, to: anchor + 1 };
  return { from: anchor, to: anchor + AGENDA_DAYS };
}

/**
 * The anchor one view further on (`by` 1) or back (`by` -1). A month keeps its day of the month,
 * moved back when the next month is shorter.
 * @param {Mode} mode
 * @param {number} anchor
 * @param {number} by
 */
export function step(mode, anchor, by) {
  if (mode === "week") return anchor + 7 * by;
  if (mode === "day") return anchor + by;
  if (mode === "agenda") return anchor + AGENDA_DAYS * by;
  const { y, m, d } = ymd(anchor);
  const month = m - 1 + by;
  const year = y + Math.floor(month / 12);
  const next = (((month % 12) + 12) % 12) + 1;
  return dayNumber(year, next, Math.min(d, daysInMonth(year, next)));
}

/**
 * Whether an occurrence is on a day (a zero-length event at midnight is on that day).
 * @param {Occurrence} occ
 * @param {number} day
 */
export const onDay = (occ, day) => {
  const start = day * DAY;
  const end = start + DAY;
  return (
    occ.startWall < end &&
    (occ.endWall > start || (occ.endWall === occ.startWall && occ.startWall >= start))
  );
};

/** Events drawn in the all-day row: all-day events and timed ones that last a day or more. */
export const banner = (/** @type {Occurrence} */ occ) =>
  occ.allDay || occ.endWall - occ.startWall >= DAY;

/**
 * The month grid: six weeks of days, each with its events, all-day and long ones first.
 * @param {Occurrence[]} list
 * @param {number} anchor
 * @param {number} weekStart
 * @param {number} today
 */
export function monthGrid(list, anchor, weekStart, today) {
  const { from } = span("month", anchor, weekStart);
  const { m } = ymd(anchor);
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, i) => {
      const day = from + w * 7 + i;
      const events = list
        .filter((o) => onDay(o, day))
        .sort((a, b) => Number(banner(b)) - Number(banner(a)) || a.startWall - b.startWall);
      return { day, inMonth: ymd(day).m === m, today: day === today, events };
    }),
  );
}

/**
 * A day's timed events as blocks: overlapping events share the width in columns, and each group of
 * events that overlap one another (a cluster) is as wide as it needs.
 * @param {Occurrence[]} list
 * @param {number} day
 * @returns {Block[]}
 */
export function dayBlocks(list, day) {
  const start = day * DAY;
  const end = start + DAY;
  const items = list
    .filter((o) => !banner(o) && onDay(o, day))
    .map((occ) => {
      const top = (Math.max(occ.startWall, start) - start) / MINUTE;
      const bottom = (Math.min(occ.endWall, end) - start) / MINUTE;
      return {
        occ,
        top,
        height: Math.max(bottom - top, SHORTEST),
        col: 0,
        cols: 1,
        continues: occ.endWall > end,
        continued: occ.startWall < start,
      };
    })
    .sort((a, b) => a.top - b.top || b.height - a.height);
  /** @type {Block[][]} */
  const clusters = [];
  let reach = -1;
  for (const item of items) {
    if (item.top >= reach) clusters.push([]);
    clusters.at(-1)?.push(item);
    reach = Math.max(reach, item.top + item.height);
  }
  for (const cluster of clusters) {
    /** @type {number[]} the bottom of the last block in each column */
    const columns = [];
    for (const item of cluster) {
      const free = columns.findIndex((bottom) => bottom <= item.top);
      item.col = free < 0 ? columns.length : free;
      columns[item.col] = item.top + item.height;
    }
    for (const item of cluster) item.cols = columns.length;
  }
  return items;
}

/**
 * The agenda: the days from `from` to `to` that have events, each with them.
 * @param {Occurrence[]} list
 * @param {number} from
 * @param {number} to
 */
export function agenda(list, from, to) {
  /** @type {Array<{ day: number, events: Occurrence[] }>} */
  const days = [];
  for (let day = from; day < to; day++) {
    const events = list.filter((o) => onDay(o, day));
    if (events.length) days.push({ day, events });
  }
  return days;
}
