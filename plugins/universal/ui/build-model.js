// The view builder's model (ADR 0102), without a DOM: what a source answered (its fields), the
// roles each shape draws, which field likely plays which role, and the universal view the builder's
// choices make. Switching the shape keeps the source, the map and the data: only `type` changes.

/**
 * @typedef {import("../../../packages/bridge/src/index").UniversalView} UniversalView
 * @typedef {import("../../../packages/bridge/src/index").UniversalData} UniversalData
 * @typedef {import("../../../packages/bridge/src/index").UniversalSource} UniversalSource
 * @typedef {import("../../../packages/bridge/src/index").UniversalType} UniversalType
 * @typedef {import("../../../packages/bridge/src/index").UniversalMap} UniversalMap
 * @typedef {"file" | "url" | "command" | "items"} SourceKind
 * @typedef {{ kind: SourceKind, path?: string, url?: string, command?: string, args?: string,
 *   kinds?: string[] }} SourceInput
 * @typedef {{ id?: string, title: string, type: UniversalType, source: UniversalSource,
 *   map: Record<string, string> }} BuildState
 */

/** The shapes, in the builder's order, with what the person reads. */
export const SHAPES = /** @type {const} */ ([
  { type: "list", label: "List" },
  { type: "kanban", label: "Board" },
  { type: "timeline", label: "Timeline" },
  { type: "calendar", label: "Calendar" },
  { type: "text", label: "Document" },
  { type: "chat", label: "Chat" },
  { type: "agent", label: "Run" },
]);

/** The roles each shape draws, the most telling first. */
export const ROLES = /** @type {Record<UniversalType, readonly string[]>} */ ({
  list: ["title", "detail", "status", "start", "tags"],
  kanban: ["title", "group", "detail", "status"],
  timeline: ["title", "start", "end", "detail"],
  calendar: ["title", "start", "end"],
  text: ["title", "text"],
  chat: ["author", "text", "start"],
  agent: ["title", "status", "text", "start", "end"],
});

/** The item kinds the builder offers for an items source. */
export const KINDS = ["task", "event", "note", "message", "file", "person"];

/** Field names that usually play a role, by role, when no field has the role's own name. */
const LIKELY = /** @type {Record<string, string[]>} */ ({
  title: ["name", "subject", "summary", "label", "headline", "heading"],
  start: ["due", "date", "when", "time", "at", "startAt", "createdAt", "created", "modifiedAt"],
  end: ["endAt", "until", "finish", "finishedAt", "dueAt"],
  group: ["status", "state", "column", "stage", "lane", "category", "kind", "type"],
  status: ["state", "result", "outcome"],
  author: ["from", "sender", "user", "by", "who", "owner"],
  text: ["body", "content", "message", "markdown", "description"],
  detail: ["description", "summary", "notes", "location", "owner"],
  tags: ["labels", "categories", "topics"],
  url: ["link", "href", "web"],
});
const DATE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * The fields of the entries, most common first (then by name): every top-level key of the first
 * 500 entries.
 * @param {UniversalData | null | undefined} data
 * @returns {string[]}
 */
export function fieldsOf(data) {
  const counts = new Map();
  for (const entry of (data?.entries ?? []).slice(0, 500))
    for (const key of Object.keys(entry)) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a, m], [b, n]) => n - m || (a < b ? -1 : a > b ? 1 : 0))
    .map(([key]) => key);
}

/**
 * Which field plays each role, for the roles whose own name no field has: a likely name first, then
 * for start a field whose values read as dates. The data's own map is kept as it is.
 * @param {UniversalData | null | undefined} data
 * @returns {Record<string, string>}
 */
export function suggestMap(data) {
  const fields = fieldsOf(data);
  const has = new Set(fields);
  /** @type {Record<string, string>} */
  const map = {};
  const taken = new Set(Object.values(data?.map ?? {}));
  for (const [role, names] of Object.entries(LIKELY)) {
    if (has.has(role) || (data?.map && role in data.map)) continue;
    const found = names.find((name) => has.has(name) && !taken.has(name));
    if (found) {
      map[role] = found;
      taken.add(found);
    }
  }
  if (!map.start && !has.has("start")) {
    const first = data?.entries?.[0] ?? {};
    const dated = fields.find((f) => !taken.has(f) && DATE.test(String(first[f] ?? "")));
    if (dated) map.start = dated;
  }
  return map;
}

/**
 * The source the builder's inputs name, or why they name none.
 * @param {SourceInput} input
 * @returns {{ source: UniversalSource } | { problem: string }}
 */
export function sourceOf(input) {
  if (input.kind === "file") {
    const path = (input.path ?? "").trim();
    if (!/^(\/|~(\/|$)|[A-Za-z]:\/|\$\{(workspace|home)\}(\/|$))/.test(path))
      return { problem: "Give a path that starts with ~/ or /." };
    return { source: { file: path } };
  }
  if (input.kind === "url") {
    const url = (input.url ?? "").trim();
    if (!/^https?:\/\/[^\s/?#]+([/?#]\S*)?$/.test(url))
      return { problem: "Give an http or https address." };
    return { source: { url } };
  }
  if (input.kind === "command") {
    const command = (input.command ?? "").trim();
    if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(command))
      return { problem: "Give a command id like example.feed.get." };
    const text = (input.args ?? "").trim();
    if (!text) return { source: { command } };
    try {
      const args = JSON.parse(text);
      if (!args || typeof args !== "object" || Array.isArray(args))
        return { problem: "The arguments are a JSON object." };
      return { source: { command, args } };
    } catch {
      return { problem: "The arguments are not JSON." };
    }
  }
  const kinds = (input.kinds ?? []).filter((k) => KINDS.includes(k));
  return { source: { items: kinds.length ? { kinds: /** @type {any} */ (kinds) } : {} } };
}

/**
 * The builder's inputs for a source, to fill the form when it edits a view.
 * @param {UniversalSource} source
 * @returns {SourceInput}
 */
export function inputOf(source) {
  if ("file" in source) return { kind: "file", path: source.file };
  if ("url" in source) return { kind: "url", url: source.url };
  if ("command" in source)
    return {
      kind: "command",
      command: source.command,
      args: source.args ? JSON.stringify(source.args) : "",
    };
  if ("items" in source) return { kind: "items", kinds: [...(source.items.kinds ?? [])] };
  return { kind: "file", path: "" };
}

/**
 * The universal view the builder's choices make: its type first in the presentations the person may
 * switch to (every shape), the map's empty roles left out.
 * @param {BuildState} state
 * @returns {UniversalView}
 */
export function viewOf(state) {
  const map = Object.fromEntries(Object.entries(state.map).filter(([, field]) => field));
  const types = [state.type, ...SHAPES.map((s) => s.type).filter((t) => t !== state.type)];
  return {
    ...(state.id ? { id: state.id } : {}),
    ...(state.title.trim() ? { title: state.title.trim() } : {}),
    type: state.type,
    types,
    source: state.source,
    ...(Object.keys(map).length ? { map: /** @type {UniversalMap} */ (map) } : {}),
  };
}

/**
 * The id the builder saves a new view under: `my.<slug of its title>`.
 * @param {string} title
 */
export function idFor(title) {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  if (!slug) return "my.view";
  return `my.${/^[a-z]/.test(slug) ? slug : `view-${slug}`}`;
}
