// The time and board presentations as data: a timeline's days, a calendar's cells, a board's
// columns. Pure; the element draws them.
import { byStart, type UniversalRow } from "./rows";
import {
  addDays,
  addMonths,
  dateOf,
  dayLabel,
  dayOf,
  monthLabel,
  timeText,
  type UniversalEnv,
  weekdayNames,
  weekdayOf,
} from "./time";

/** One row on a timeline: its time, or All day, and until when. */
export interface TimelineRow {
  row: UniversalRow;
  time: string;
  until: string;
  past: boolean;
  current: boolean;
}

export interface TimelineDay {
  day: string;
  label: string;
  today: boolean;
  rows: TimelineRow[];
}

export interface TimelineModel {
  days: TimelineDay[];
  /** Rows without a start, after the days. */
  undated: UniversalRow[];
  /** Where the now-line goes: before rows[index] of days[day] (index = length: after the last). */
  now: { day: number; index: number } | null;
}

/** The day a row starts on in the zone. */
const startDay = (row: UniversalRow, env: UniversalEnv) =>
  row.start === undefined ? "" : dayOf(row.start, env.zone);

/** The last day a row covers: its end is exclusive. */
const endDay = (row: UniversalRow, env: UniversalEnv) =>
  row.end === undefined || row.start === undefined || row.end <= row.start
    ? startDay(row, env)
    : dayOf(row.end - 1, env.zone);

function timelineRow(row: UniversalRow, env: UniversalEnv): TimelineRow {
  const start = row.start ?? 0;
  const end = row.end ?? start;
  return {
    row,
    time: row.allDay ? "All day" : timeText(start, env),
    until: row.allDay || row.end === undefined || row.end === start ? "" : timeText(end, env),
    past: row.end !== undefined ? row.end <= env.now : start < env.now,
    current: start <= env.now && env.now < end,
  };
}

/** A timeline: dated rows by day in time order, the now-line when today is within them. */
export function timelineOf(
  rows: UniversalRow[],
  env: UniversalEnv,
  order: "asc" | "desc" = "asc",
): TimelineModel {
  const sorted = byStart(rows, order);
  const dated = sorted.filter((row) => row.start !== undefined);
  const undated = sorted.filter((row) => row.start === undefined);
  const today = dayOf(env.now, env.zone);
  const year = Number(today.slice(0, 4));
  const days: TimelineDay[] = [];
  for (const row of dated) {
    const day = startDay(row, env);
    let last = days[days.length - 1];
    if (!last || last.day !== day) {
      last = { day, label: dayLabel(day, env, year), today: day === today, rows: [] };
      days.push(last);
    }
    last.rows.push(timelineRow(row, env));
  }
  const first = days[0]?.day ?? "";
  const final = days[days.length - 1]?.day ?? "";
  const [low, high] = first <= final ? [first, final] : [final, first];
  let now: TimelineModel["now"] = null;
  if (days.length > 0 && low <= today && today <= high) {
    const ahead = (r: TimelineRow) =>
      order === "asc" ? (r.row.start ?? 0) > env.now : (r.row.start ?? 0) <= env.now;
    now = { day: days.length - 1, index: days[days.length - 1]?.rows.length ?? 0 };
    for (const [d, group] of days.entries()) {
      const index = group.rows.findIndex(ahead);
      if (index >= 0) {
        now = { day: d, index };
        break;
      }
    }
  }
  return { days, undated, now };
}

export type CalendarRange = "day" | "week" | "month";

export interface CalendarEntry {
  row: UniversalRow;
  /** "" for a whole day, else the start time on its first day. */
  time: string;
  /** Whether it began on an earlier day. */
  continues: boolean;
}

export interface CalendarCell {
  day: string;
  number: number;
  label: string;
  inPeriod: boolean;
  today: boolean;
  weekend: boolean;
  entries: CalendarEntry[];
}

export interface CalendarModel {
  range: CalendarRange;
  /** A day in the period shown. */
  anchor: string;
  title: string;
  /** Weekday names over the columns, Monday first; one for a day. */
  weekdays: string[];
  columns: number;
  cells: CalendarCell[];
  /** Anchors of the period before and after, and of today. */
  prev: string;
  next: string;
  today: string;
  /** How many rows have no start and so no day. */
  undated: number;
}

/** The longest run of days one entry is drawn on. */
const MAX_SPAN = 62;

/** A calendar period (a month by default) around `anchor` (today when absent) with its entries. */
export function calendarOf(
  rows: UniversalRow[],
  env: UniversalEnv,
  options: { range?: CalendarRange; anchor?: string } = {},
): CalendarModel {
  const range = options.range ?? "month";
  const today = dayOf(env.now, env.zone);
  const anchor = options.anchor ?? today;
  const first = range === "month" ? addMonths(anchor, 0) : anchor;
  let from = first;
  let to = first;
  let prev = addDays(anchor, -1);
  let next = addDays(anchor, 1);
  if (range === "month") {
    const last = addDays(addMonths(anchor, 1), -1);
    from = addDays(first, -weekdayOf(first));
    to = addDays(last, 6 - weekdayOf(last));
    prev = addMonths(anchor, -1);
    next = addMonths(anchor, 1);
  } else if (range === "week") {
    from = addDays(anchor, -weekdayOf(anchor));
    to = addDays(from, 6);
    prev = addDays(from, -7);
    next = addDays(from, 7);
  }
  const year = Number(today.slice(0, 4));
  const cells: CalendarCell[] = [];
  const byDay = new Map<string, CalendarCell>();
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const cell: CalendarCell = {
      day,
      number: dateOf(day),
      label: dayLabel(day, env, year),
      inPeriod: range !== "month" || day.slice(0, 7) === anchor.slice(0, 7),
      today: day === today,
      weekend: weekdayOf(day) >= 5,
      entries: [],
    };
    cells.push(cell);
    byDay.set(day, cell);
  }
  for (const row of byStart(rows)) {
    if (row.start === undefined) continue;
    const begins = startDay(row, env);
    const ends = endDay(row, env);
    let day = begins;
    if (day < from) day = from;
    for (let n = 0; day <= ends && day <= to && n < MAX_SPAN; n++, day = addDays(day, 1)) {
      const continues = day !== begins;
      const time = row.allDay || continues ? "" : timeText(row.start, env);
      byDay.get(day)?.entries.push({ row, time, continues });
    }
  }
  const title =
    range === "month"
      ? monthLabel(first, env)
      : range === "week"
        ? `${dayLabel(from, env, year)} – ${dayLabel(to, env, year)}`
        : dayLabel(anchor, env, year);
  const names = weekdayNames(env);
  return {
    range,
    anchor,
    title,
    weekdays: range === "day" ? [names[weekdayOf(anchor)] ?? ""] : names,
    columns: range === "day" ? 1 : 7,
    cells,
    prev,
    next,
    today,
    undated: rows.filter((row) => row.start === undefined).length,
  };
}

export interface KanbanColumn {
  /** The group value; "" for entries without one. */
  group: string;
  title: string;
  rows: UniversalRow[];
}

/**
 * A board's columns: `groups` first, in order and even when empty; then the other groups in the
 * order they first appear; entries without a group last, under No group.
 */
export function kanbanOf(rows: UniversalRow[], groups: readonly string[] = []): KanbanColumn[] {
  const columns = new Map<string, KanbanColumn>();
  const column = (group: string) => {
    let found = columns.get(group);
    if (!found) {
      found = { group, title: group || "No group", rows: [] };
      columns.set(group, found);
    }
    return found;
  };
  for (const group of groups) column(group);
  for (const row of rows) if (row.group) column(row.group).rows.push(row);
  const loose = rows.filter((row) => !row.group);
  if (loose.length > 0) column("").rows.push(...loose);
  return [...columns.values()];
}
