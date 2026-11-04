// Linear: an issue as Linear's GraphQL API returns it (`identifier`, `state { name, type }`,
// `priority` 0 to 4, `labels { nodes }`, `team`, `project`, `cycle`, `dueDate`, `estimate`), or as
// Linear's MCP server lists it, flattened (`status` a name, `assignee` a name, `labels` names,
// `priority { value, name }`). Both are kept whole in the item's `raw`.
import {
  categoryOfName,
  dateOf,
  namesOf,
  numberOf,
  objectOf,
  PRIORITY_TITLES,
  personOf,
  textOf,
} from "./common.js";

/**
 * @typedef {import("./common.js").Work} Work
 * @typedef {import("./common.js").Category} Category
 * @typedef {import("@endue-ai/bridge").TaskItem} TaskItem
 */

/** Linear's workflow state types and the board's categories. */
const CATEGORY = /** @type {Record<string, Category>} */ ({
  triage: "backlog",
  backlog: "backlog",
  unstarted: "todo",
  started: "doing",
  completed: "done",
  canceled: "cancelled",
  cancelled: "cancelled",
});

/** Whether an item comes from Linear: its connector says so, or its raw is a Linear issue. */
export function detect(/** @type {TaskItem} */ item) {
  if (/linear/i.test(item.source.connector)) return true;
  const raw = objectOf(item.raw);
  return Boolean(
    raw && typeof raw.identifier === "string" && (objectOf(raw.state) || objectOf(raw.team)),
  );
}

/** Linear's priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low; a number or `{ value, name }`. */
function priorityOf(/** @type {Record<string, any>} */ raw) {
  const value = numberOf(raw.priority) ?? numberOf(objectOf(raw.priority)?.value);
  if (value === undefined) return {};
  const rank = value >= 1 && value <= 4 ? value : null;
  const name = textOf(raw.priorityLabel) ?? textOf(objectOf(raw.priority)?.name);
  return {
    priority: rank,
    priorityName: rank === null ? undefined : (name ?? PRIORITY_TITLES[rank]),
  };
}

/** A cycle's name, else "Cycle <number>". */
function cycleOf(/** @type {unknown} */ value) {
  const cycle = objectOf(value);
  if (!cycle) return textOf(value);
  return (
    textOf(cycle.name) ??
    (numberOf(cycle.number) === undefined ? undefined : `Cycle ${cycle.number}`)
  );
}

/** @returns {Partial<Work>} */
export function adapt(/** @type {TaskItem} */ item) {
  const raw = objectOf(item.raw) ?? {};
  const state = objectOf(raw.state);
  const status = textOf(state) ?? textOf(raw.status);
  const type = textOf(state?.type) ?? textOf(raw.statusType);
  const category =
    (type && CATEGORY[type.toLowerCase()]) || (status ? categoryOfName(status) : undefined);
  const assignee = personOf(raw.assignee);
  return {
    system: "linear",
    ref: typeof raw.identifier === "string" ? raw.identifier : "",
    url: item.deepLink ?? (typeof raw.url === "string" ? raw.url : undefined),
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...priorityOf(raw),
    ...(assignee ? { assignee } : {}),
    labels: namesOf(raw.labels),
    project: textOf(raw.project) ?? textOf(raw.team) ?? item.project,
    sprint: cycleOf(raw.cycle),
    parent: textOf(objectOf(raw.parent)?.identifier) ?? textOf(raw.parentId),
    start: dateOf(raw.startDate) ?? dateOf(raw.startedAt),
    due: dateOf(raw.dueDate) ?? dateOf(item.due),
    estimate: numberOf(raw.estimate) ?? numberOf(objectOf(raw.estimate)?.value),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
    completedAt: typeof raw.completedAt === "string" ? raw.completedAt : undefined,
  };
}
