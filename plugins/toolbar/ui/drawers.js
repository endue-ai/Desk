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
  ["audio:capture", "Microphone", (p) => (p.wakeWord ? ["wake word"] : [])],
  ["fs:read", "Read files", (p) => p.paths],
  ["fs:write", "Write files", (p) => p.paths],
  ["proc:spawn", "Run programs", (p) => [...p.commands, ...(p.pty ? ["in a terminal"] : [])]],
  ["net:fetch", "Network", (p) => p.hosts],
  ["brain:converse", "Talk to the brain", () => []],
  ["ui:notify", "Notifications", () => []],
  ["ui:surface", "Open surfaces", () => []],
  ["plugin:manage", "Manage plugins", () => []],
];

/**
 * What the plugins that are on may ask for, grouped by permission. These come from the manifests:
 * each one is still granted by the person at first use.
 * @param {PluginInfo[]} plugins
 * @returns {Drawer}
 */
export function accessDrawer(plugins) {
  const on = plugins.filter(isOn);
  const rows = [];
  for (const [permission, label, scopeOf] of KINDS) {
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
