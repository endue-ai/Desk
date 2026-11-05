// From the state to what the screen shows: the toolbar, the body of the current view (its columns,
// lanes, rows, bars or weeks), the order the keys walk, and the open work's details. The DOM in
// view.js and render/ only draws what this says.
import { CATEGORY_TITLES } from "./adapters/common.js";
import { columnsOf, emptyColumns, lanesOf } from "./layout/board.js";
import { calendarOf } from "./layout/calendar.js";
import { dateOfDay, monthTitle, shortDate } from "./layout/dates.js";
import { timelineOf } from "./layout/timeline.js";
import {
  assigneeTitle,
  FIELDS,
  filtered,
  GROUPS,
  grouped,
  priorityTitle,
  sorted,
  sourceTitle,
  statusesOf,
  VIEW_TITLES,
  VIEWS,
} from "./model.js";

/**
 * @typedef {import("./adapters/common.js").Work} Work
 * @typedef {import("./state.js").State} State
 * @typedef {import("./layout/board.js").Column} Column
 * @typedef {import("./layout/board.js").Lane} Lane
 * @typedef {{ title: string, text: string }} Fact
 * @typedef {{
 *   work: Work, statuses: string[], canMove: boolean, canUpdate: boolean,
 *   facts: Fact[], source: string,
 * }} Detail
 * @typedef {(
 *   | { kind: "kanban", columns: Column[] }
 *   | { kind: "swimlane", columns: Column[], lanes: Lane[], by: string }
 *   | { kind: "list", groups: import("./model.js").Group[] }
 *   | { kind: "table", columns: Array<{ name: string, title: string, sort: "asc" | "desc" | null }>, rows: Work[], estimate: number }
 *   | ({ kind: "timeline" } & ReturnType<typeof timelineOf>)
 *   | ({ kind: "calendar" } & ReturnType<typeof calendarOf>)
 * )} Body
 * @typedef {{
 *   view: State["view"], views: Array<{ name: string, title: string }>,
 *   search: string, group: string, groups: Array<{ name: string, title: string }>,
 *   source: string | null, sources: Array<{ key: string, title: string }>, showDone: boolean,
 *   zoom: State["zoom"], period: string, today: string,
 *   body: Body, order: string[], selected: string | null, detail: Detail | null,
 *   empty: { text: string, connect: boolean } | null, count: number, loading: boolean,
 * }} Screen
 */

/** Which of the toolbar's controls each view uses. */
export const USES = {
  group: new Set(["swimlane", "list", "timeline"]),
  period: new Set(["timeline", "calendar"]),
};

/** The work a view shows, in the order the keys walk it. */
function orderOf(/** @type {Body} */ body) {
  switch (body.kind) {
    case "kanban":
      return body.columns.flatMap((c) => c.works.map((w) => w.key));
    case "swimlane":
      return body.lanes.flatMap((lane) => lane.cells.flat().map((w) => w.key));
    case "list":
      return body.groups.flatMap((g) => g.works.map((w) => w.key));
    case "table":
      return body.rows.map((w) => w.key);
    case "timeline":
      return body.rows.flatMap((r) => r.bars.map((b) => b.work.key));
    case "calendar":
      return body.weeks.flat().flatMap((cell) => cell.works.map((w) => w.key));
  }
}

/** The body of the current view over the work the filter keeps. @returns {Body} */
export function bodyOf(/** @type {State} */ s, /** @type {Work[]} */ works) {
  switch (s.view) {
    case "kanban": {
      const columns = columnsOf(works);
      return { kind: "kanban", columns: columns.length ? columns : emptyColumns() };
    }
    case "swimlane":
      return {
        kind: "swimlane",
        ...lanesOf(works, s.group),
        by: FIELDS[s.group]?.group ? s.group : "assignee",
      };
    case "list":
      return { kind: "list", groups: grouped(sorted(works, s.sort), s.group) };
    case "table":
      return {
        kind: "table",
        columns: s.columns.map((name) => ({
          name,
          title: FIELDS[name]?.title ?? name,
          sort: s.sort?.field === name ? s.sort.dir : null,
        })),
        rows: sorted(works, s.sort),
        estimate: works.reduce((sum, w) => sum + (w.estimate ?? 0), 0),
      };
    case "timeline":
      return {
        kind: "timeline",
        ...timelineOf(works, {
          anchor: s.anchor,
          zoom: s.zoom,
          group: FIELDS[s.group]?.group ? s.group : "project",
          weekStart: s.weekStart,
          today: s.today,
        }),
      };
    case "calendar":
      return {
        kind: "calendar",
        ...calendarOf(works, { anchor: s.anchor, weekStart: s.weekStart, today: s.today }),
      };
  }
}

/** The details of the open work, with what its connector lets the person change. */
export function detailOf(/** @type {State} */ s) {
  const work = s.works.find((w) => w.key === s.open);
  if (!work) return null;
  const today = dateOfDay(s.today);
  const can = s.available[work.source.connector] ?? [];
  /** @type {Fact[]} */
  const facts = [
    { title: "Status", text: `${work.status} (${CATEGORY_TITLES[work.category]})` },
    { title: "Type", text: work.type ?? "" },
    { title: "Assignee", text: assigneeTitle(work) || "Unassigned" },
    { title: "Priority", text: priorityTitle(work) || "None" },
    { title: "Project", text: work.project ?? "" },
    { title: "Sprint", text: work.sprint ?? "" },
    { title: "Labels", text: work.labels.join(", ") },
    { title: "Parent", text: work.parent ?? "" },
    { title: "Start", text: shortDate(work.start, today) },
    { title: "Due", text: shortDate(work.due, today) },
    { title: "Estimate", text: work.estimate === undefined ? "" : String(work.estimate) },
    { title: "Updated", text: shortDate(work.updatedAt.slice(0, 10), today) },
  ].filter((f) => f.text !== "");
  return /** @type {Detail} */ ({
    work,
    statuses: statusesOf(s.works, work.source.connector),
    canMove: can.includes("move"),
    canUpdate: can.includes("update"),
    facts,
    source: sourceTitle(work),
  });
}

/** The period the timeline or calendar shows, as its title. */
function periodOf(/** @type {Body} */ body) {
  if (body.kind === "calendar") return body.title;
  if (body.kind !== "timeline") return "";
  const today = dateOfDay(body.from);
  const first = shortDate(dateOfDay(body.from), today);
  const last = shortDate(dateOfDay(body.from + body.days - 1), today);
  return body.days > 31 ? `${monthTitle(body.from)} · ${first} – ${last}` : `${first} – ${last}`;
}

/** @returns {Screen} */
export function screenOf(/** @type {State} */ s) {
  const works = filtered(s.works, s.filter);
  const body = bodyOf(s, works);
  const order = orderOf(body);
  const connected = s.sources.length > 0 || s.works.length > 0;
  const empty =
    !s.loaded || works.length > 0
      ? null
      : !connected
        ? {
            text: "No tasks yet. Connect Jira, Linear or Asana to see their work here.",
            connect: true,
          }
        : {
            text: s.works.length
              ? "Nothing matches the filter."
              : "No tasks in the connected sources.",
            connect: false,
          };
  return {
    view: s.view,
    views: VIEWS.map((name) => ({ name, title: VIEW_TITLES[name] })),
    search: s.filter.text,
    group: s.group,
    groups: GROUPS.map((name) => ({ name, title: FIELDS[name]?.title ?? "None" })),
    source: s.filter.source,
    sources: s.sources,
    showDone: s.filter.showDone,
    zoom: s.zoom,
    period: periodOf(body),
    today: dateOfDay(s.today),
    body,
    order,
    selected: s.selected !== null && order.includes(s.selected) ? s.selected : null,
    detail: detailOf(s),
    empty,
    count: works.length,
    loading: s.loading,
  };
}
