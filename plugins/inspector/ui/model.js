// What the view shows of each section: tables of text, one or more groups, with a summary. Plain
// data in, plain data out. The filter keeps the rows with a cell (or a group title) that contains
// the query, ignoring case; the export never sees it.

/**
 * @typedef {import("./sections.js").Section} Section
 * @typedef {{ title: string, columns: string[], rows: string[][] }} Group
 * @typedef {{ summary: string, groups: Group[], total: number, noun: string }} Table
 * @typedef {{ tag: string, id?: string, class?: string, role?: string, box?: number[],
 *   text?: string, children?: TreeNode[], [field: string]: unknown }} TreeNode
 */

/** Rows past this many are left out of the page (the export keeps them all). */
export const LIMIT = 2000;

const plural = (/** @type {number} */ n, /** @type {string} */ noun) =>
  `${n} ${noun}${n === 1 ? "" : "s"}`;
const LAYERS = /** @type {Record<string, string>} */ ({
  default: "manifest default",
  init: "init.yaml",
  profile: "profile",
  session: "this session",
});
const json = (/** @type {unknown} */ value) => {
  const text = JSON.stringify(value) ?? "";
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
};

/**
 * @param {Section} section
 * @param {any} data
 * @returns {Table}
 */
export function tableOf(section, data) {
  switch (section) {
    case "tree":
      return tree(data);
    case "surfaces":
      return surfaces(data);
    case "commands":
      return commands(data);
    case "grants":
      return grants(data);
    case "settings":
      return settings(data);
    case "plugins":
      return plugins(data);
    case "calls":
      return calls(data);
  }
}

/** @param {TreeNode} root */
function tree(root) {
  /** @type {string[][]} */
  const rows = [];
  const walk = (/** @type {TreeNode} */ node, /** @type {number} */ depth) => {
    const classes = node.class ? `.${node.class.trim().split(/\s+/).join(".")}` : "";
    const marks = ["data-surface", "role"]
      .filter((name) => typeof node[name] === "string")
      .map((name) => ` [${name}="${node[name]}"]`)
      .join("");
    const label = `${"  ".repeat(depth)}${node.tag}${node.id ? `#${node.id}` : ""}${classes}${marks}`;
    const [x, y, w, h] = node.box ?? [];
    rows.push([label, `${x} ${y} ${w}×${h}`, node.text ?? ""]);
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  if (root) walk(root, 0);
  const columns = ["Element", "Box", "Text"];
  const summary = plural(rows.length, "element");
  return {
    summary,
    groups: [{ title: "#desk", columns, rows }],
    total: rows.length,
    noun: "elements",
  };
}

/** @param {{ surfaces: any[], views: any[], buffers: any[] }} data */
function surfaces({ surfaces = [], views = [], buffers = [] }) {
  const state = (/** @type {boolean} */ visible, /** @type {boolean} */ focused) =>
    [visible ? "visible" : "hidden", focused ? "focused" : ""].filter(Boolean).join(" · ");
  const groups = [
    {
      title: "Surfaces",
      columns: ["Surface", "Plugin", "Placement", "State"],
      rows: surfaces.map((s) => [s.id, s.plugin ?? "", s.placement, state(s.visible, s.focused)]),
    },
    {
      title: "Views",
      columns: ["View", "Title", "State"],
      rows: views.map((v) => [v.id, v.title, v.focused ? "focused" : ""]),
    },
    {
      title: "Buffers",
      columns: ["Buffer", "Plugin", "File", "State"],
      rows: buffers.map((b) => [b.name, b.plugin, b.path ?? "", b.modified ? "modified" : ""]),
    },
  ];
  const parts = [
    plural(surfaces.length, "surface"),
    plural(views.length, "view"),
    plural(buffers.length, "buffer"),
  ];
  const total = surfaces.length + views.length + buffers.length;
  return { summary: parts.join(", "), groups, total, noun: "entries" };
}

/** @param {import("@endue-ai/bridge").CommandInvocation[]} invocations */
function commands(invocations = []) {
  const rows = [...invocations]
    .reverse()
    .map((i) => [
      new Date(i.at).toISOString().slice(11, 23),
      i.id,
      i.caller,
      i.provider,
      i.durationMs === undefined ? "" : `${i.durationMs} ms`,
      i.ok === undefined ? "waiting" : i.ok ? "ok" : (i.error ?? "failed"),
    ]);
  const columns = ["Time (UTC)", "Command", "Caller", "Provider", "Duration", "Outcome"];
  return {
    summary: `${plural(rows.length, "invocation")}, newest first`,
    groups: [{ title: "Invocations", columns, rows }],
    total: rows.length,
    noun: "invocations",
  };
}

/** @param {import("@endue-ai/bridge").CallerGrant[]} held */
function grants(held = []) {
  /** @type {Map<string, string[][]>} */
  const byCaller = new Map();
  for (const { caller, grant } of held) {
    const { permission, ...scope } = grant.permission;
    const words = Object.entries(scope)
      .map(([field, v]) => `${field}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
      .join("; ");
    const rows = byCaller.get(caller) ?? [];
    rows.push([grant.grantId, permission, words, grant.duration]);
    byCaller.set(caller, rows);
  }
  const columns = ["Grant", "Permission", "Scope", "Duration"];
  const groups = [...byCaller.keys()]
    .sort()
    .map((caller) => ({ title: caller, columns, rows: byCaller.get(caller) ?? [] }));
  const summary = `${plural(held.length, "grant")} held by ${plural(groups.length, "caller")}`;
  return { summary, groups, total: held.length, noun: "grants" };
}

/** @param {Array<{ key: string, value: unknown, layer: string, owner?: string,
 *   skipped?: Array<{ layer: string, value: unknown }> }>} all */
function settings(all = []) {
  const rows = all.map((s) => {
    const skipped = (s.skipped ?? []).map((k) => `${LAYERS[k.layer] ?? k.layer} ${json(k.value)}`);
    const layer = LAYERS[s.layer] ?? s.layer;
    return [
      s.key,
      json(s.value),
      skipped.length > 0 ? `${layer} (skipped: ${skipped.join(", ")})` : layer,
      s.owner ?? "",
    ];
  });
  const columns = ["Setting", "Value", "Layer", "Plugin"];
  const groups = [{ title: "Settings", columns, rows }];
  return { summary: plural(rows.length, "setting"), groups, total: rows.length, noun: "settings" };
}

/** @param {Array<ReturnType<typeof import("./sections.js").pluginState>>} all */
function plugins(all = []) {
  const rows = all.map((p) => {
    const state = [
      p.state,
      p.autoload ? "autoload" : "",
      p.quarantined === true ? "quarantined" : "",
      p.notResponding === true ? "not responding" : "",
    ];
    const status = p.status === "failed" && p.error ? `failed: ${p.error}` : p.status;
    return [p.id, p.name ?? "", p.kind ?? "", state.filter(Boolean).join(" · "), status];
  });
  const on = all.filter((p) => p.state === "on").length;
  const columns = ["Plugin", "Name", "Kind", "State", "Status"];
  return {
    summary: `${plural(all.length, "plugin")}, ${on} on`,
    groups: [{ title: "Plugins", columns, rows }],
    total: all.length,
    noun: "plugins",
  };
}

/** @param {import("@endue-ai/bridge").PluginStatsResult} stats */
function calls(stats) {
  const callers = stats?.callers ?? [];
  const rows = callers.map((c) => [c.caller, String(c.calls), String(c.failed)]);
  return {
    summary: `Bridge calls over the last ${stats?.windowSeconds ?? 60} s, by caller`,
    groups: [{ title: "Callers", columns: ["Caller", "Calls", "Failed"], rows }],
    total: rows.length,
    noun: "callers",
  };
}

/**
 * The rows that match `query` (a group whose title matches keeps every row), at most LIMIT.
 * @param {Table} table
 * @param {string} query
 * @returns {Table}
 */
export function filtered(table, query) {
  const q = query.trim().toLowerCase();
  const matches = (/** @type {string} */ cell) => cell.toLowerCase().includes(q);
  let left = LIMIT;
  const groups = table.groups
    .map((group) => {
      const rows =
        !q || matches(group.title) ? group.rows : group.rows.filter((r) => r.some(matches));
      const kept = rows.slice(0, Math.max(0, left));
      left -= kept.length;
      return { ...group, rows: kept, matched: rows.length };
    })
    .filter((group) => !q || group.matched > 0);
  const shown = groups.reduce((n, g) => n + g.matched, 0);
  let summary = q
    ? `${shown} of ${table.total} ${table.noun} match “${query.trim()}”`
    : table.summary;
  if (left < 0 || shown > LIMIT) summary += `; the first ${LIMIT} shown`;
  return {
    ...table,
    summary,
    groups: groups.map(({ matched: _matched, ...group }) => group),
  };
}
