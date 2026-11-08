// The calendar without its DOM: the weeks of the month that holds the anchor, each day holding the
// work due that day (or starting that day, when it has no due date). Work with neither date is
// counted as unscheduled.
import { byDefault } from "../model.js";
import {
  addMonths,
  dateOfDay,
  dayOf,
  monthOf,
  monthTitle,
  weekdayOf,
  weekStartOf,
} from "./dates.js";

/**
 * @typedef {import("../adapters/common.js").Work} Work
 * @typedef {{
 *   day: number, date: string, inMonth: boolean, today: boolean, weekend: boolean,
 *   works: Work[], late: Set<string>,
 * }} Cell
 * `late` holds the keys of open work due before today.
 */

/** The day a piece of work sits on: its due date, else its start. */
export function dayFor(/** @type {Work} */ w) {
  const due = dayOf(w.due);
  return Number.isNaN(due) ? dayOf(w.start) : due;
}

/** Where the previous or next month's view lands, from the anchor. */
export const stepMonth = (/** @type {number} */ anchor, /** @type {1 | -1} */ dir) =>
  addMonths(anchor, dir);

/**
 * @param {Work[]} works
 * @param {{ anchor: number, weekStart: number, today: number }} at
 */
export function calendarOf(works, { anchor, weekStart, today }) {
  const { first, next } = monthOf(anchor);
  const start = weekStartOf(first, weekStart);
  const end = weekStartOf(next - 1, weekStart) + 7;
  /** @type {Map<number, Work[]>} */
  const byDay = new Map();
  let unscheduled = 0;
  for (const w of works) {
    const day = dayFor(w);
    if (Number.isNaN(day)) {
      unscheduled++;
      continue;
    }
    const list = byDay.get(day) ?? [];
    list.push(w);
    byDay.set(day, list);
  }
  /** @type {Cell[][]} */
  const weeks = [];
  for (let week = start; week < end; week += 7) {
    /** @type {Cell[]} */
    const cells = [];
    for (let day = week; day < week + 7; day++) {
      const list = (byDay.get(day) ?? []).sort(byDefault);
      const weekday = weekdayOf(day);
      cells.push({
        day,
        date: dateOfDay(day),
        inMonth: day >= first && day < next,
        today: day === today,
        weekend: weekday === 0 || weekday === 6,
        works: list,
        late: new Set(
          day < today
            ? list
                .filter((w) => w.due && w.category !== "done" && w.category !== "cancelled")
                .map((w) => w.key)
            : [],
        ),
      });
    }
    weeks.push(cells);
  }
  const weekdays = Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
  return { title: monthTitle(first), first, weeks, weekdays, unscheduled };
}
