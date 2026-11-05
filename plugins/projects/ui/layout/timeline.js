// The timeline without its DOM: a span of days from the week that holds the anchor, rows grouped by a
// field, and one bar per piece of work from its start to its due date. Work with only a due date
// is a milestone on that day; work with only a start is one day long; work with neither is counted
// as unscheduled. A bar that runs past the span is cut and says so.
import { grouped } from "../model.js";
import { addMonths, dateOfDay, dayOf, dayParts, weekStartOf } from "./dates.js";

/**
 * @typedef {import("../adapters/common.js").Work} Work
 * @typedef {"week" | "month" | "quarter"} Zoom
 * @typedef {{
 *   work: Work, left: number, span: number,
 *   cutStart: boolean, cutEnd: boolean, milestone: boolean, late: boolean,
 * }} Bar
 * `left` and `span` count days from the first day shown.
 * @typedef {{ day: number, date: string, label: string, month: string, weekend: boolean, today: boolean }} Tick
 */

/** How many days each zoom shows. */
export const ZOOMS = /** @type {Record<Zoom, number>} */ ({ week: 14, month: 42, quarter: 91 });

/** Where the previous or next span starts, from the anchor. */
export function step(
  /** @type {number} */ anchor,
  /** @type {Zoom} */ zoom,
  /** @type {1 | -1} */ dir,
) {
  if (zoom === "week") return anchor + 7 * dir;
  return addMonths(anchor, (zoom === "month" ? 1 : 3) * dir);
}

/** The days a piece of work covers, or undefined when it has no date. */
export function spanOf(/** @type {Work} */ w) {
  const start = dayOf(w.start);
  const due = dayOf(w.due);
  if (Number.isNaN(start) && Number.isNaN(due)) return undefined;
  const from = Number.isNaN(start) ? due : start;
  const to = Number.isNaN(due) ? from : Math.max(due, from);
  return { from, to, milestone: Number.isNaN(start) };
}

/**
 * @param {Work[]} works
 * @param {{ anchor: number, zoom: Zoom, group: string, weekStart: number, today: number }} at
 */
export function timelineOf(works, { anchor, zoom, group, weekStart, today }) {
  const from = weekStartOf(anchor, weekStart);
  const days = ZOOMS[zoom];
  const to = from + days;
  /** @type {Map<string, Bar>} */
  const bars = new Map();
  let unscheduled = 0;
  let outside = 0;
  for (const w of works) {
    const span = spanOf(w);
    if (!span) {
      unscheduled++;
      continue;
    }
    if (span.to < from || span.from >= to) {
      outside++;
      continue;
    }
    const left = Math.max(span.from, from) - from;
    const end = Math.min(span.to, to - 1) - from;
    const open = w.category !== "done" && w.category !== "cancelled";
    bars.set(w.key, {
      work: w,
      left,
      span: end - left + 1,
      cutStart: span.from < from,
      cutEnd: span.to >= to,
      milestone: span.milestone,
      late: open && !Number.isNaN(dayOf(w.due)) && dayOf(w.due) < today,
    });
  }
  const visible = works.filter((w) => bars.has(w.key));
  const rows = grouped(visible, group).map((g) => ({
    key: g.key,
    title: g.title,
    bars: g.works
      .map((w) => /** @type {Bar} */ (bars.get(w.key)))
      .sort(
        (a, b) => a.left - b.left || a.span - b.span || a.work.title.localeCompare(b.work.title),
      ),
  }));
  /** @type {Tick[]} */
  const scale = [];
  for (let day = from; day < to; day++) {
    const parts = dayParts(day);
    scale.push({
      day,
      date: dateOfDay(day),
      label: String(parts.date),
      month: parts.date === 1 || day === from ? parts.month : "",
      weekend: parts.weekday === 0 || parts.weekday === 6,
      today: day === today,
    });
  }
  return {
    from,
    days,
    scale,
    rows,
    unscheduled,
    outside,
    todayAt: today >= from && today < to ? today - from : null,
  };
}
