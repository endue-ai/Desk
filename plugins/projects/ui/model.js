// The plugin's work without its DOM: the views it has, the fields a piece of work shows, and how a
// set of work is filtered, grouped and sorted. Every view reads its rows, columns and lanes from here.
import { CATEGORIES, CATEGORY_TITLES, PRIORITY_TITLES } from "./adapters/common.js";
import { systemTitle } from "./adapters/index.js";

/**
 * @typedef {import("./adapters/common.js").Work} Work
 * @typedef {"kanban" | "swimlane" | "list" | "table" | "timeline" | "calendar"} ViewName
 * @typedef {{ key: string, title: string, order: number }} GroupKey
 * @typedef {{ key: string, title: string, order: number, works: Work[] }} Group
 * @typedef {{ title: string, group?: (w: Work) => GroupKey, value: (w: Work) => string | number | null }} Field
 * @typedef {{ field: string, dir: "asc" | "desc" }} Sort
 * @typedef {{ text: string, source: string | null, showDone: boolean }} Filter
 */

/** The views, in the order the switcher and the keys 1 to 6 have them. */
export const VIEWS = /** @type {ViewName[]} */ ([
  "kanban",
  "swimlane",
  "list",
  "table",
  "timeline",
  "calendar",
]);
export const VIEW_TITLES = /** @type {Record<ViewName, string>} */ ({
  kanban: "Kanban",
  swimlane: "Swimlane",
  list: "List",
  table: "Database",
  timeline: "Timeline",
  calendar: "Calendar",
});

/** A status name as a column knows it: "To Do", "Todo" and "to-do" are one column. */
export const statusKey = (/** @type {string} */ name) =>
  name.toLowerCase().replace(/[\s_\-.]+/g, "");
const rank = (/** @type {Work} */ w) => CATEGORIES.indexOf(w.category);
const none = (/** @type {string} */ title) => ({ key: "", title, order: Number.MAX_SAFE_INTEGER });
const named = (/** @type {string | undefined} */ value, /** @type {string} */ empty) =>
  value ? { key: value.toLowerCase(), title: value, order: 0 } : none(empty);

/** The source a piece of work came from, as one line: "Jira", "Linear · work". */
export const sourceTitle = (/** @type {Work} */ w) => {
  const name = systemTitle(w.system, w.source.connector);
  return w.source.instance === "default" ? name : `${name} · ${w.source.instance}`;
};
/** Who a piece of work is assigned to, as one line. */
export const assigneeTitle = (/** @type {Work} */ w) => w.assignee?.name ?? w.assignee?.email ?? "";
export const priorityTitle = (/** @type {Work} */ w) =>
  w.priorityName ?? (w.priority === null ? "" : (PRIORITY_TITLES[w.priority] ?? ""));

/** @type {Record<string, Field>} */
export const FIELDS = {
  ref: { title: "Key", value: (w) => w.ref || null },
  title: { title: "Title", value: (w) => w.title.toLowerCase() },
  status: {
    title: "Status",
    group: (w) => ({ key: statusKey(w.status), title: w.status, order: rank(w) }),
    value: (w) => `${rank(w)}:${w.status.toLowerCase()}`,
  },
  category: {
    title: "Category",
    group: (w) => ({ key: w.category, title: CATEGORY_TITLES[w.category], order: rank(w) }),
    value: rank,
  },
  assignee: {
    title: "Assignee",
    group: (w) => {
      const who = assigneeTitle(w);
      return who
        ? { key: (w.assignee?.email ?? who).toLowerCase(), title: who, order: 0 }
        : none("Unassigned");
    },
    value: (w) => assigneeTitle(w).toLowerCase() || null,
  },
  priority: {
    title: "Priority",
    group: (w) =>
      w.priority === null
        ? none("No priority")
        : { key: String(w.priority), title: PRIORITY_TITLES[w.priority] ?? "", order: w.priority },
    value: (w) => w.priority,
  },
  project: {
    title: "Project",
    group: (w) => named(w.project, "No project"),
    value: (w) => w.project?.toLowerCase() ?? null,
  },
  sprint: {
    title: "Sprint",
    group: (w) => named(w.sprint, "No sprint"),
    value: (w) => w.sprint?.toLowerCase() ?? null,
  },
  type: {
    title: "Type",
    group: (w) => named(w.type, "No type"),
    value: (w) => w.type?.toLowerCase() ?? null,
  },
  labels: { title: "Labels", value: (w) => w.labels.join(", ").toLowerCase() || null },
  start: { title: "Start", value: (w) => w.start ?? null },
  due: { title: "Due", value: (w) => w.due ?? null },
  estimate: { title: "Estimate", value: (w) => w.estimate ?? null },
  source: {
    title: "Source",
    group: (w) => ({
      key: `${w.source.connector}/${w.source.instance}`,
      title: sourceTitle(w),
      order: 0,
    }),
    value: (w) => sourceTitle(w).toLowerCase(),
  },
  updated: { title: "Updated", value: (w) => Date.parse(w.updatedAt) || null },
};

/** The fields a view can group by; `none` keeps one group. */
export const GROUPS = Object.keys(FIELDS)
  .filter((name) => FIELDS[name]?.group)
  .concat("none");
/** The fields the database view can show as columns. */
export const COLUMNS = Object.keys(FIELDS);
export const DEFAULT_COLUMNS = ["ref", "title", "status", "assignee", "priority", "due", "source"];

/**
 * Order by a field, missing values last whichever way; ties by the default order.
 * @param {Work[]} works
 * @param {Sort | null} sort
 */
export function sorted(works, sort) {
  const field = sort ? FIELDS[sort.field] : undefined;
  const sign = sort?.dir === "desc" ? -1 : 1;
  return [...works].sort((a, b) => {
    if (field) {
      const x = field.value(a);
      const y = field.value(b);
      if (x !== y) {
        if (x === null) return 1;
        if (y === null) return -1;
        return (x < y ? -1 : 1) * sign;
      }
    }
    return byDefault(a, b);
  });
}

/** The default order: most urgent first, then the soonest due, then the latest change. */
export function byDefault(/** @type {Work} */ a, /** @type {Work} */ b) {
  const pa = a.priority ?? 9;
  const pb = b.priority ?? 9;
  if (pa !== pb) return pa - pb;
  const da = a.due ?? "9999";
  const db = b.due ?? "9999";
  if (da !== db) return da < db ? -1 : 1;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Split work into groups by a field, in the field's order; `none` (or an unknown field) is one group.
 * @param {Work[]} works
 * @param {string} by
 * @returns {Group[]}
 */
export function grouped(works, by) {
  const field = FIELDS[by];
  if (!field?.group) return [{ key: "", title: "All", order: 0, works }];
  /** @type {Map<string, Group>} */
  const groups = new Map();
  for (const w of works) {
    const g = field.group(w);
    const found = groups.get(g.key);
    if (found) found.works.push(w);
    else groups.set(g.key, { ...g, works: [w] });
  }
  return [...groups.values()].sort(
    (a, b) => a.order - b.order || a.title.localeCompare(b.title, "en", { sensitivity: "base" }),
  );
}

/** Whether a piece of work holds every word of a search. */
export function matchesText(/** @type {Work} */ w, /** @type {string} */ text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [
    w.ref,
    w.title,
    w.status,
    w.project ?? "",
    w.sprint ?? "",
    w.type ?? "",
    assigneeTitle(w),
    w.assignee?.email ?? "",
    ...w.labels,
  ]
    .join(" ")
    .toLowerCase();
  return words.every((word) => hay.includes(word));
}

/** The work a filter keeps: its source (`connector/instance`), finished work or not, the search. */
export function filtered(/** @type {Work[]} */ works, /** @type {Filter} */ filter) {
  return works.filter(
    (w) =>
      (filter.source === null || `${w.source.connector}/${w.source.instance}` === filter.source) &&
      (filter.showDone || (w.category !== "done" && w.category !== "cancelled")) &&
      matchesText(w, filter.text),
  );
}

/** The statuses one connector's work has, in board order: what a piece of work can move to. */
export function statusesOf(/** @type {Work[]} */ works, /** @type {string} */ connector) {
  /** @type {Map<string, { name: string, order: number }>} */
  const seen = new Map();
  for (const w of works)
    if (w.source.connector === connector && !seen.has(statusKey(w.status)))
      seen.set(statusKey(w.status), { name: w.status, order: rank(w) });
  return [...seen.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((s) => s.name);
}
