// What every adapter shares: the one shape a piece of work takes on screen (Work), what the item's
// envelope already says (specs/item/v0: status, due, priority, project, deepLink), and the small
// readers that turn a source's values (a string, `{ name }`, `{ displayName }`, `{ nodes }`) into it.
// An adapter fills what its source says and keeps the envelope's word for the rest.

/**
 * @typedef {import("@endue-ai/bridge").TaskItem} TaskItem
 * @typedef {import("@endue-ai/bridge").ItemSource} ItemSource
 * @typedef {"backlog" | "todo" | "doing" | "done" | "cancelled"} Category
 * @typedef {"jira" | "linear" | "asana" | "github" | "other"} System
 * @typedef {{ name?: string, email?: string }} Person
 * @typedef {{
 *   key: string, id: string, source: ItemSource, system: System,
 *   ref: string, title: string, url?: string, body?: string,
 *   status: string, category: Category, type?: string,
 *   priority: number | null, priorityName?: string,
 *   assignee?: Person, labels: string[], project?: string, sprint?: string, parent?: string,
 *   start?: string, due?: string, estimate?: number,
 *   createdAt?: string, updatedAt: string, completedAt?: string,
 *   item: TaskItem,
 * }} Work
 * `start` and `due` are dates (YYYY-MM-DD) as the source wrote them; `priority` is the item kind's
 * 1 (most urgent) to 4, null for none.
 */

/** The categories in board order, and what each is called on screen. */
export const CATEGORIES = /** @type {const} */ (["backlog", "todo", "doing", "done", "cancelled"]);
export const CATEGORY_TITLES = /** @type {Record<Category, string>} */ ({
  backlog: "Backlog",
  todo: "To do",
  doing: "In progress",
  done: "Done",
  cancelled: "Cancelled",
});
/** The item kind's priorities by rank, as a board says them. */
export const PRIORITY_TITLES = ["", "Urgent", "High", "Medium", "Low"];

/** A plain object, or undefined. @returns {Record<string, any> | undefined} */
export const objectOf = (/** @type {unknown} */ value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, any>} */ (value)
    : undefined;

/** A non-empty string from a string or a `{ name | displayName | value | key }` object. */
export function textOf(/** @type {unknown} */ value) {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  const o = objectOf(value);
  if (!o) return undefined;
  for (const field of ["name", "displayName", "value", "title", "key"])
    if (typeof o[field] === "string" && o[field].trim()) return o[field].trim();
  return undefined;
}

/** A person from a name, an email, or a user object of any of the three sources. */
export function personOf(/** @type {unknown} */ value) {
  if (typeof value === "string" && value.trim()) {
    const text = value.trim();
    return /** @type {Person} */ (text.includes("@") ? { email: text } : { name: text });
  }
  const o = objectOf(value);
  if (!o) return undefined;
  const name = textOf(o.displayName ?? o.name);
  const email = typeof (o.emailAddress ?? o.email) === "string" ? (o.emailAddress ?? o.email) : "";
  if (!name && !email) return undefined;
  return /** @type {Person} */ ({ ...(name ? { name } : {}), ...(email ? { email } : {}) });
}

/** Names from strings, `{ name }`s, or a GraphQL connection `{ nodes }`. */
export function namesOf(/** @type {unknown} */ value) {
  const list = Array.isArray(value) ? value : (objectOf(value)?.nodes ?? []);
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(textOf).filter((n) => n !== undefined))];
}

/** The date (YYYY-MM-DD) a date or a timestamp names, as its source wrote it. */
export function dateOf(/** @type {unknown} */ value) {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

/** A finite number, or undefined. */
export const numberOf = (/** @type {unknown} */ value) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** A status name's category when the source says none: from words every tracker uses. */
export function categoryOfName(/** @type {string | undefined} */ name, fallback = "todo") {
  const n = (name ?? "").toLowerCase();
  if (/cancel|won'?t|rejected|declined|duplicate|obsolete|abandon/.test(n)) return "cancelled";
  if (/\b(done|closed|complete|completed|resolved|shipped|released|merged)\b/.test(n))
    return "done";
  if (/backlog|icebox|triage|someday|later|idea/.test(n)) return "backlog";
  if (/progress|doing|review|testing|\bqa\b|started|active|blocked|develop|working/.test(n))
    return "doing";
  if (/to ?do|open|new|ready|planned|selected|next|unstarted/.test(n)) return "todo";
  return /** @type {Category} */ (fallback);
}

/** A priority name's rank, 1 (most urgent) to 4, or null. */
export function rankOfName(/** @type {string | undefined} */ name) {
  const n = (name ?? "").toLowerCase().trim();
  if (!n || /^(none|no priority|-)$/.test(n)) return null;
  if (/urgent|highest|blocker|critical|p0|p1\b/.test(n)) return 1;
  if (/^high|major|\bp2\b/.test(n)) return 2;
  if (/medium|normal|moderate|\bp3\b/.test(n)) return 3;
  if (/low|minor|trivial|\bp4\b|\bp5\b/.test(n)) return 4;
  return null;
}

/** The key the plugin knows an item by: `connector/instance#id`, as the index keys it. */
export const keyOf = (/** @type {ItemSource} */ source, /** @type {string} */ id) =>
  `${source.connector}/${source.instance}#${id}`;

/** What the envelope alone says, which every adapter starts from. @returns {Work} */
export function envelopeOf(/** @type {TaskItem} */ item) {
  const category =
    item.status === "done" ? "done" : item.status === "cancelled" ? "cancelled" : "todo";
  const priority = numberOf(item.priority);
  const raw = objectOf(item.raw) ?? {};
  return {
    key: keyOf(item.source, item.id),
    id: item.id,
    source: item.source,
    system: "other",
    ref: "",
    title: item.title,
    ...(item.deepLink ? { url: item.deepLink } : {}),
    ...(item.body ? { body: item.body } : {}),
    status: textOf(raw.status) ?? CATEGORY_TITLES[category],
    category,
    priority: priority !== undefined && priority >= 1 && priority <= 4 ? priority : null,
    labels: namesOf(raw.labels),
    ...(item.project ? { project: item.project } : {}),
    ...(dateOf(item.due) ? { due: dateOf(item.due) } : {}),
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    updatedAt: item.updatedAt,
    ...(item.completedAt ? { completedAt: item.completedAt } : {}),
    item,
  };
}

/**
 * Lay what an adapter read over the envelope: only the fields it found replace the envelope's.
 * @param {Work} base
 * @param {Partial<Work>} read
 * @returns {Work}
 */
export function over(base, read) {
  /** @type {Record<string, unknown>} */
  const out = { ...base };
  for (const [field, value] of Object.entries(read)) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[field] = value;
  }
  return /** @type {Work} */ (out);
}
