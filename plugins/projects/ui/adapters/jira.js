// Jira: an issue as Jira's REST API and the Atlassian MCP server (searchJiraIssuesUsingJql,
// getJiraIssue) return it, kept whole in the item's `raw`: `{ key, self, fields: { status,
// issuetype, priority, assignee, labels, project, duedate, ... } }`. A connector that flattened the
// fields into `raw` itself is read the same way.
import {
  categoryOfName,
  dateOf,
  namesOf,
  numberOf,
  objectOf,
  personOf,
  rankOfName,
  textOf,
} from "./common.js";

/**
 * @typedef {import("./common.js").Work} Work
 * @typedef {import("./common.js").Category} Category
 * @typedef {import("@endue-ai/bridge").TaskItem} TaskItem
 */

const KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
/** Jira's status categories (statusCategory.key) and the board's. */
const CATEGORY = /** @type {Record<string, Category>} */ ({
  new: "todo",
  undefined: "todo",
  indeterminate: "doing",
  done: "done",
});

/** Whether an item comes from Jira: its connector says so, or its raw is a Jira issue. */
export function detect(/** @type {TaskItem} */ item) {
  if (/jira|atlassian/i.test(item.source.connector)) return true;
  const raw = objectOf(item.raw);
  return Boolean(raw && objectOf(raw.fields) && typeof raw.key === "string" && KEY.test(raw.key));
}

/** The sprint an issue is in: the active one of the sprint field, else the latest. */
function sprintOf(/** @type {Record<string, any>} */ f) {
  const field = f.sprint ?? f.customfield_10020;
  const list = Array.isArray(field) ? field : field ? [field] : [];
  const sprints = list.map(objectOf).filter((s) => s !== undefined);
  const active = sprints.find((s) => s.state === "active") ?? sprints.at(-1);
  return textOf(active) ?? (typeof field === "string" ? field : undefined);
}

/** The browse URL from the issue's REST `self`, when the connector gave no deep link. */
function browseOf(/** @type {Record<string, any>} */ raw) {
  if (typeof raw.self !== "string" || typeof raw.key !== "string") return undefined;
  try {
    return `${new URL(raw.self).origin}/browse/${raw.key}`;
  } catch {
    return undefined;
  }
}

/** @returns {Partial<Work>} */
export function adapt(/** @type {TaskItem} */ item) {
  const raw = objectOf(item.raw) ?? {};
  const f = objectOf(raw.fields) ?? raw;
  const status = textOf(f.status);
  const statusCategory = textOf(objectOf(objectOf(f.status)?.statusCategory)?.key);
  let category = statusCategory ? CATEGORY[statusCategory] : undefined;
  // Jira files "Backlog" under To Do and "Won't Do" under Done; their names say better.
  const named = categoryOfName(status, category ?? "todo");
  if (!category || (category === "todo" && named === "backlog")) category = named;
  if (category === "done" && named === "cancelled") category = "cancelled";
  const priorityName = textOf(f.priority);
  const priority = priorityName ? rankOfName(priorityName) : undefined;
  const assignee = personOf(f.assignee);
  const project = objectOf(f.project);
  return {
    system: "jira",
    ref: typeof raw.key === "string" ? raw.key : "",
    title: textOf(f.summary) ?? item.title,
    url: item.deepLink ?? browseOf(raw),
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    type: textOf(f.issuetype),
    ...(priority !== undefined ? { priority, priorityName } : {}),
    ...(assignee ? { assignee } : {}),
    labels: namesOf(f.labels),
    project: textOf(project?.name ?? project?.key) ?? item.project,
    sprint: sprintOf(f),
    parent: textOf(objectOf(f.parent)?.key),
    start: dateOf(f.startdate ?? f.customfield_10015),
    due: dateOf(f.duedate) ?? dateOf(item.due),
    estimate: numberOf(f.storyPoints ?? f.customfield_10016),
    createdAt: typeof f.created === "string" ? f.created : undefined,
    completedAt: typeof f.resolutiondate === "string" ? f.resolutiondate : undefined,
  };
}
