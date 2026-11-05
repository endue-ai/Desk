// The plugin's state and its defaults: what is loaded, which view shows it and how, and what the
// store keeps between runs (the view, grouping, sort, filter, zoom and columns, never the work).

import { ZOOMS } from "./layout/timeline.js";
import { COLUMNS, DEFAULT_COLUMNS, GROUPS, VIEWS } from "./model.js";

/**
 * @typedef {import("./adapters/common.js").Work} Work
 * @typedef {import("./model.js").ViewName} ViewName
 * @typedef {import("./model.js").Sort} Sort
 * @typedef {import("./model.js").Filter} Filter
 * @typedef {import("./layout/timeline.js").Zoom} Zoom
 * @typedef {"move" | "update"} Action
 * @typedef {{
 *   works: Work[], view: ViewName, group: string, sort: Sort | null, filter: Filter,
 *   selected: string | null, open: string | null, anchor: number, zoom: Zoom,
 *   today: number, weekStart: number, columns: string[],
 *   sources: Array<{ key: string, title: string }>,
 *   available: Record<string, Action[]>, loading: boolean, truncated: boolean, loaded: boolean,
 * }} State
 * `available` lists, per connector, the actions it provides; `truncated` says more work exists
 * than the plugin loads.
 */

/** The settings, by their name under endue.projects, and their defaults. */
export const DEFAULTS = {
  view: "kanban",
  "week-start": "monday",
  "show-done": true,
  columns: DEFAULT_COLUMNS,
};
/** The most work the plugin loads, in pages of 500. */
export const MAX_WORK = 2000;
export const PAGE = 500;

export const asString = (/** @type {unknown} */ value) =>
  typeof value === "string" && value !== "" ? value : undefined;
/** @returns {Record<string, unknown>} */
export const asArgs = (/** @type {unknown} */ value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};

export const isView = (/** @type {unknown} */ v) =>
  typeof v === "string" && VIEWS.includes(/** @type {ViewName} */ (v));
export const isGroup = (/** @type {unknown} */ v) => typeof v === "string" && GROUPS.includes(v);
export const isZoom = (/** @type {unknown} */ v) => typeof v === "string" && v in ZOOMS;

/** The database view's columns from a setting or the store: known fields, title always there. */
export function columnsFrom(/** @type {unknown} */ value) {
  const list = Array.isArray(value)
    ? value.filter((c) => typeof c === "string" && COLUMNS.includes(c))
    : [];
  const unique = [...new Set(list)];
  if (unique.length === 0) return [...DEFAULT_COLUMNS];
  return unique.includes("title") ? unique : ["title", ...unique];
}

/** A sort from the store, or null. @returns {Sort | null} */
export function sortFrom(/** @type {unknown} */ value) {
  const s = asArgs(value);
  if (typeof s.field !== "string" || !COLUMNS.includes(s.field)) return null;
  return { field: s.field, dir: s.dir === "desc" ? "desc" : "asc" };
}

/** @returns {State} */
export function initialState(/** @type {number} */ today) {
  return {
    works: [],
    view: "kanban",
    group: "assignee",
    sort: null,
    filter: { text: "", source: null, showDone: true },
    selected: null,
    open: null,
    anchor: today,
    zoom: "month",
    today,
    weekStart: 1,
    columns: [...DEFAULT_COLUMNS],
    sources: [],
    available: {},
    loading: false,
    truncated: false,
    loaded: false,
  };
}

/** What the store keeps of the state. */
export const saved = (/** @type {State} */ s) => ({
  view: s.view,
  group: s.group,
  sort: s.sort,
  source: s.filter.source,
  showDone: s.filter.showDone,
  zoom: s.zoom,
  columns: s.columns,
});

/** Put back what the store kept, keeping only what still makes sense. */
export function restore(/** @type {State} */ s, /** @type {unknown} */ value) {
  const v = asArgs(value);
  if (isView(v.view)) s.view = /** @type {ViewName} */ (v.view);
  if (isGroup(v.group)) s.group = /** @type {string} */ (v.group);
  s.sort = sortFrom(v.sort);
  if (typeof v.source === "string") s.filter.source = v.source;
  if (typeof v.showDone === "boolean") s.filter.showDone = v.showDone;
  if (isZoom(v.zoom)) s.zoom = /** @type {Zoom} */ (v.zoom);
  if (Array.isArray(v.columns)) s.columns = columnsFrom(v.columns);
}
