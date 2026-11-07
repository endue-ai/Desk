// The toolbar's drawers, built from plugin.list. Plain data in, plain data out, so it is tested
// without a DOM. A new drawer is one more function here and one more entry in `drawers`.

/**
 * @typedef {{ label: string, detail: string, warning?: boolean }} Row
 * @typedef {{ id: string, title: string, summary: string, warning: boolean, note?: string,
 *   empty: string, rows: Row[] }} Drawer
 * @typedef {import("@endue-ai/bridge").PluginInfo} PluginInfo
 */

const nameOf = (/** @type {PluginInfo} */ plugin) => plugin.manifest?.name || plugin.id;
const isOn = (/** @type {PluginInfo} */ plugin) => plugin.status === "ready" && plugin.enabled;

/**
 * Plugins on, off and failed. Failed ones come first, with their reasons.
 * @param {PluginInfo[]} plugins
 * @returns {Drawer}
 */
export function pluginsDrawer(plugins) {
  const failed = plugins.filter((p) => p.status === "failed");
  const off = plugins.filter((p) => p.status === "ready" && !p.enabled);
  const on = plugins.filter(isOn).length;
  const counts = [`${on} on`];
  if (off.length > 0) counts.push(`${off.length} off`);
  if (failed.length > 0) counts.push(`${failed.length} failed`);
  return {
    id: "plugins",
    title: "Plugins",
    summary: counts.join(" · "),
    warning: failed.length > 0,
    empty: "Every plugin is on.",
    rows: [
      ...failed.map((p) => ({ label: nameOf(p), detail: p.error ?? "failed", warning: true })),
      ...off.map((p) => ({ label: nameOf(p), detail: "Off" })),
    ],
  };
}

/** Permissions in plain words, most sensitive first, with how to show their scope. */
const KINDS = [
  ["perm:manage", "Manage permissions", () => []],
  ["plugin:manage", "Manage plugins", () => []],
  ["update:manage", "Manage desk updates", () => []],
  ["account:manage", "Sign the desk in to endue ID", () => []],
  ["agents:manage", "Read local agents' sessions and hand them work", () => []],
  ["memory:read", "Read Eris's memory", () => []],
  ["memory:write", "Keep and forget what Eris remembers", () => []],
  ["connector:manage", "Manage connections", () => []],
  ["cmd:advise", "Override commands", () => []],
  [
    "shell:open",
    "Open links and show files",
    (p) => [
      ...(p.schemes ?? []).map((scheme) => `scheme: ${scheme}`),
      ...(p.paths ?? []).map((path) => `path: ${path}`),
    ],
  ],
  [
    "proc:spawn",
    "Run programs",
    (p) => [...(p.commands ?? []), ...(p.pty ? ["in a terminal"] : [])],
  ],
  ["fs:read", "Read files", (p) => p.paths],
  ["fs:write", "Write files", (p) => p.paths],
  ["search:system", "Search system files and apps", () => []],
  ["net:fetch", "Network", (p) => p.hosts],
  ["audio:capture", "Microphone", (p) => (p.wakeWord ? ["wake word"] : [])],
  [
    "data:read",
    "Read indexed data",
    (p) => [`kinds: ${p.kinds?.join(", ") ?? "all"}`, `sources: ${p.sources?.join(", ") ?? "all"}`],
  ],
  ["settings:read", "Read settings", (p) => p.keys],
  ["log:read", "Read logs", () => []],
  ["events:subscribe", "Listen for events", (p) => p.names],
  ["cmd:invoke", "Run commands", (p) => p.ids],
  ["view:manage", "Manage views", () => []],
  ["theme:manage", "Manage themes", () => []],
  ["search:read", "Search published items", () => []],
  ["brain:converse", "Talk to the brain", () => []],
  ["brain:ask", "Ask the brain", () => []],
  ["ui:notify", "Notifications", () => []],
  ["ui:surface", "Open surfaces", () => []],
];

/** Show fields of a permission introduced after this toolbar was released. */
const unknownScope = (p) =>
  Object.entries(p)
    .filter(([key]) => key !== "permission")
    .map(
      ([key, value]) =>
        `${key}: ${Array.isArray(value) ? value.join(", ") : JSON.stringify(value)}`,
    );

/**
 * What the plugins that are on may ask for, grouped by permission. These come from the manifests:
 * each one is still granted by the person at first use.
 * @param {PluginInfo[]} plugins
 * @returns {Drawer}
 */
export function accessDrawer(plugins) {
  const on = plugins.filter(isOn);
  const rows = [];
  const known = new Set(KINDS.map(([permission]) => permission));
  const unknown = new Set(
    on.flatMap((plugin) =>
      (plugin.manifest?.permissions ?? [])
        .map((p) => p.permission)
        .filter((permission) => !known.has(permission)),
    ),
  );
  for (const [permission, label, scopeOf] of [
    ...KINDS,
    ...[...unknown].map((id) => [id, id, unknownScope]),
  ]) {
    const askers = on.flatMap((plugin) =>
      (plugin.manifest?.permissions ?? [])
        .filter((p) => p.permission === permission)
        .map((p) => {
          const scope = scopeOf(p) ?? [];
          return scope.length > 0 ? `${nameOf(plugin)} (${scope.join(", ")})` : nameOf(plugin);
        }),
    );
    if (askers.length > 0) rows.push({ label, detail: askers.join(", ") });
  }
  return {
    id: "access",
    title: "Access",
    summary: rows.length > 0 ? `${rows.length} permissions` : "None",
    warning: false,
    note: "What the plugins that are on may ask for. Each is still yours to allow at first use.",
    empty: "No plugin asks for access.",
    rows,
  };
}

/**
 * Every drawer, in the order the panel shows them.
 * @param {PluginInfo[]} plugins
 * @returns {Drawer[]}
 */
export function drawers(plugins) {
  return [pluginsDrawer(plugins), accessDrawer(plugins)];
}
