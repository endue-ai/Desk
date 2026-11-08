// The inspector's sections and where each comes from: the core's bridge methods (cmd.recent,
// perm.list, plugin.list, plugin.stats) and the runtime's desk.inspect.open for what only it knows
// (the render tree, surfaces and buffers, settings by layer). Export JSON and `desk inspect` print
// the same text (crates/desk-cli/src/remote/inspect.rs): keys sorted, two spaces.

/**
 * @typedef {"tree" | "surfaces" | "commands" | "grants" | "settings" | "plugins" | "calls"} Section
 * @typedef {import("@endue-ai/bridge").PluginInfo} PluginInfo
 * @typedef {{ call(method: string, params: unknown): Promise<any>,
 *   run(id: string, args: Record<string, unknown>): Promise<unknown> }} Sources
 */

/** @type {readonly Section[]} */
export const SECTIONS = ["tree", "surfaces", "commands", "grants", "settings", "plugins", "calls"];

/** @type {Record<Section, string>} */
export const LABELS = {
  tree: "Render tree",
  surfaces: "Surfaces and buffers",
  commands: "Commands",
  grants: "Grants",
  settings: "Settings",
  plugins: "Plugins",
  calls: "Bridge calls",
};

/** The sections the runtime answers. Each read is a command invocation, so they refresh less often. */
export const RUNTIME = new Set(["tree", "surfaces", "settings"]);
export const INSPECT = "desk.inspect.open";
const MANAGE = { permission: "perm:manage" };
const PLUGINS = { permission: "plugin:manage" };

/**
 * One section's data, as `desk inspect <section>` prints it under the section's name.
 * @param {Section} section
 * @param {Sources} sources
 * @returns {Promise<unknown>}
 */
export async function fetchSection(section, { call, run }) {
  switch (section) {
    case "commands":
      return (await call("cmd.recent", { scope: MANAGE })).invocations;
    case "grants":
      return (await call("perm.list", { scope: MANAGE })).grants;
    case "plugins":
      return (await call("plugin.list", { scope: PLUGINS })).plugins.map(pluginState);
    case "calls":
      return call("plugin.stats", { scope: MANAGE });
    default:
      return run(INSPECT, { section });
  }
}

/**
 * A plugin and its state: on or off, autoload, and quarantined or not responding only when
 * plugin.list says so (#271, #272).
 * @param {PluginInfo & { quarantined?: boolean, notResponding?: boolean }} info
 */
export function pluginState(info) {
  const manifest = info.manifest;
  return {
    id: info.id,
    ...(manifest?.name ? { name: manifest.name } : {}),
    ...(manifest?.kind ? { kind: manifest.kind } : {}),
    ...(manifest?.version ? { version: manifest.version } : {}),
    state: info.enabled ? "on" : "off",
    autoload: manifest?.autoload === true,
    builtIn: info.builtIn,
    status: info.status,
    ...(info.error ? { error: info.error } : {}),
    ...("quarantined" in info ? { quarantined: info.quarantined } : {}),
    ...("notResponding" in info ? { notResponding: info.notResponding } : {}),
  };
}

/**
 * The value with every object's keys sorted.
 * @param {unknown} value
 * @returns {unknown}
 */
export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const object = /** @type {Record<string, unknown>} */ (value);
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, sortKeys(object[key])]),
  );
}

/**
 * Sections as `{ "<section>": data }`, the text Export JSON shows and `desk inspect` prints.
 * @param {Partial<Record<Section, unknown>>} sections
 */
export function exported(sections) {
  return JSON.stringify(sortKeys(sections), null, 2);
}
