// Asana: a task as Asana's REST API and its MCP server return it, kept whole in the item's `raw`:
// `{ gid, name, completed, assignee, due_on, due_at, start_on, memberships: [{ project, section }],
// tags, custom_fields: [{ name, enum_value, number_value, display_value }], permalink_url }`. Asana
// has no status of its own: a board's section is one, and "completed" says done.
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
 * @typedef {import("@endue-ai/bridge").TaskItem} TaskItem
 */

/** Whether an item comes from Asana: its connector says so, or its raw is an Asana task. */
export function detect(/** @type {TaskItem} */ item) {
  if (/asana/i.test(item.source.connector)) return true;
  const raw = objectOf(item.raw);
  return Boolean(
    raw &&
      typeof raw.gid === "string" &&
      (Array.isArray(raw.memberships) || typeof raw.permalink_url === "string"),
  );
}

/** The custom field whose name matches, by its shown value or its number. */
function custom(/** @type {Record<string, any>} */ raw, /** @type {RegExp} */ name) {
  const fields = Array.isArray(raw.custom_fields) ? raw.custom_fields : [];
  const field = fields
    .map(objectOf)
    .find((f) => f && typeof f.name === "string" && name.test(f.name));
  if (!field) return {};
  return {
    text: textOf(field.enum_value) ?? textOf(field.display_value) ?? textOf(field.text_value),
    number: numberOf(field.number_value),
  };
}

/** @returns {Partial<Work>} */
export function adapt(/** @type {TaskItem} */ item) {
  const raw = objectOf(item.raw) ?? {};
  const membership = (Array.isArray(raw.memberships) ? raw.memberships : [])
    .map(objectOf)
    .find((m) => m?.project);
  const section = textOf(membership?.section);
  const statusField = custom(raw, /^(status|stage|state)$/i).text;
  const done = raw.completed === true || item.status === "done";
  const status = statusField ?? section ?? (done ? "Done" : undefined);
  let category = status ? categoryOfName(status, done ? "done" : "todo") : undefined;
  if (done && category !== "cancelled") category = "done";
  if (!done && category === "done") category = "doing";
  const priorityName = custom(raw, /priority/i).text;
  const assignee = personOf(raw.assignee);
  const subtype = typeof raw.resource_subtype === "string" ? raw.resource_subtype : "";
  const projects = Array.isArray(raw.projects) ? raw.projects : [];
  return {
    system: "asana",
    title: textOf(raw.name) ?? item.title,
    url: item.deepLink ?? (typeof raw.permalink_url === "string" ? raw.permalink_url : undefined),
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    type: subtype === "milestone" ? "Milestone" : subtype === "approval" ? "Approval" : undefined,
    ...(priorityName ? { priority: rankOfName(priorityName), priorityName } : {}),
    ...(assignee ? { assignee } : {}),
    labels: namesOf(raw.tags),
    project: textOf(membership?.project) ?? textOf(projects[0]) ?? item.project,
    sprint: custom(raw, /sprint|iteration|cycle/i).text,
    parent: textOf(raw.parent),
    start: dateOf(raw.start_on) ?? dateOf(raw.start_at),
    due: dateOf(raw.due_on) ?? dateOf(raw.due_at) ?? dateOf(item.due),
    estimate: custom(raw, /estimate|points|effort/i).number,
    body: typeof raw.notes === "string" && raw.notes ? raw.notes : undefined,
    createdAt: typeof raw.created_at === "string" ? raw.created_at : undefined,
    completedAt: typeof raw.completed_at === "string" ? raw.completed_at : undefined,
  };
}
