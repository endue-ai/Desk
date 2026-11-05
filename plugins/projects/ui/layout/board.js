// The Kanban board and the swimlanes without their DOM. A column is a status, whichever sources use
// it: "To Do" from Jira and "Todo" from Linear are one column, which remembers what each connector
// calls it, so a card dropped there moves to its own source's status. Columns run in category order
// (backlog, to do, in progress, done, cancelled). Swimlanes cut the same columns into lanes by a field.
import { CATEGORIES, CATEGORY_TITLES } from "../adapters/common.js";
import { byDefault, FIELDS, grouped, statusKey } from "../model.js";

/**
 * @typedef {import("../adapters/common.js").Work} Work
 * @typedef {import("../adapters/common.js").Category} Category
 * @typedef {{
 *   key: string, title: string, category: Category,
 *   names: Record<string, string>, works: Work[],
 * }} Column
 * `names` is each connector's own name for the column's status.
 * @typedef {{ key: string, title: string, cells: Work[][], count: number }} Lane
 */

/** The columns a set of work fills, each sorted most urgent first. @returns {Column[]} */
export function columnsOf(/** @type {Work[]} */ works) {
  /** @type {Map<string, Column>} */
  const columns = new Map();
  for (const w of works) {
    const key = statusKey(w.status);
    let column = columns.get(key);
    if (!column) {
      column = { key, title: w.status, category: w.category, names: {}, works: [] };
      columns.set(key, column);
    }
    column.names[w.source.connector] ??= w.status;
    column.works.push(w);
  }
  const order = (/** @type {Column} */ c) => CATEGORIES.indexOf(c.category);
  const list = [...columns.values()].sort(
    (a, b) => order(a) - order(b) || a.title.localeCompare(b.title, "en", { sensitivity: "base" }),
  );
  for (const column of list) column.works.sort(byDefault);
  return list;
}

/**
 * An empty board still has somewhere to put work: one column per category but cancelled.
 * @returns {Column[]}
 */
export function emptyColumns() {
  return CATEGORIES.filter((c) => c !== "cancelled").map((category) => ({
    key: statusKey(CATEGORY_TITLES[category]),
    title: CATEGORY_TITLES[category],
    category,
    names: {},
    works: [],
  }));
}

/** The status a piece of work takes when it is dropped on a column: its own source's name for it. */
export const statusFor = (/** @type {Column} */ column, /** @type {Work} */ w) =>
  column.names[w.source.connector] ?? column.title;

/**
 * The swimlanes: one lane per group of `by`, each holding the board's columns.
 * @param {Work[]} works
 * @param {string} by
 * @returns {{ columns: Column[], lanes: Lane[] }}
 */
export function lanesOf(works, by) {
  const columns = columnsOf(works);
  const lanes = grouped(works, FIELDS[by]?.group ? by : "assignee").map((group) => {
    const inLane = new Set(group.works.map((w) => w.key));
    return {
      key: group.key,
      title: group.title,
      cells: columns.map((column) => column.works.filter((w) => inLane.has(w.key))),
      count: group.works.length,
    };
  });
  return { columns, lanes };
}

/** The fields a card dropped into another lane can change on its source; others stay put. */
export const LANE_FIELDS = /** @type {const} */ (["priority", "assignee"]);

/**
 * What moving a piece of work to another lane changes, as `task.update` args, or undefined when
 * the lane's field cannot change by moving.
 * @param {string} by
 * @param {string} laneKey
 * @param {Work[]} laneWorks some work already in the lane, which says who or what the lane is
 * @returns {Record<string, unknown> | undefined}
 */
export function laneChange(by, laneKey, laneWorks) {
  if (by === "priority") return { priority: laneKey === "" ? null : Number(laneKey) };
  if (by === "assignee") {
    if (laneKey === "") return { assignee: null };
    const who = laneWorks.find((w) => w.assignee)?.assignee;
    return who ? { assignee: who } : undefined;
  }
  return undefined;
}
