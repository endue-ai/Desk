// The settings while the plugin runs (PG-104): read through settings.get at the start and on
// Database: check the clients (settings.js), then each settings.changed of the plugin's own keys
// taken at once, so the next run reads it. What a change does beyond that is `effectsOf`: the clients
// found again, the open explorer's schema lists drawn again, the features that follow the settings
// told. A value that falls back, by settings.js's check or by the core's (settings.invalid), is said
// once in the footer and the plugin's log; all of them at the start in one notice. No DOM.
import {
  changedNames,
  checked,
  DEFAULTS,
  fallbackText,
  fullKey,
  invalidText,
  loadValues,
} from "./settings.js";

/**
 * @typedef {import("./settings.js").Settings} Settings
 * @typedef {(settings: Settings, changed: Array<keyof Settings>) => void} Apply
 * @typedef {{ owner: string, key: string, value: unknown, reason: string, file?: string, line?: number }} Invalid
 */

const OWNER = "endue.database";

/** The settings that name a program or where programs are found. */
const CLIENTS = new Set(["mysql", "sqlite3", "path", "pgDump", "pgRestore"]);

const json = (/** @type {unknown} */ value) => JSON.stringify(value) ?? String(value);

/**
 * @param {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call"> & Partial<Pick<import("@endue-ai/plugin-sdk").PluginBridge, "onEvent">>,
 *   source?: { onChange(listener: (setting: { key: string, value: unknown }) => void): () => void },
 *   say(text: string): void,
 *   apply: Apply,
 * }} deps `source` is ctx.settings (settings.changed of the plugin's own keys); `apply` hears every
 *   change of the settings in force after the start, with the names whose value changed.
 */
export function followSettings(deps) {
  /** @type {Record<string, unknown>} */
  let values = {};
  let current = DEFAULTS;
  let started = false;
  /** The values that fell back, by key, as said: a value is said again only after another one. */
  let told = new Map();
  /** The core's reports already said, and those heard before the start. */
  const heard = new Set();
  /** @type {Invalid[]} */
  const early = [];
  /** The changes heard while a load reads, laid over what it read. @type {Record<string, unknown>} */
  let since = {};

  const tell = (/** @type {string[]} */ lines) => {
    if (lines.length === 0) return;
    const message = lines.join(" ");
    deps.say(message);
    void deps.bridge.call("log.write", { level: "warn", message }).catch(() => {});
  };

  const take = (/** @type {Record<string, unknown>} */ next, start = false) => {
    values = next;
    const { settings, fallbacks } = checked(values);
    const lines = fallbacks.filter((f) => told.get(f.key) !== json(f.value)).map(fallbackText);
    told = new Map(fallbacks.map((f) => [f.key, json(f.value)]));
    const before = current;
    current = settings;
    if (start) {
      started = true;
      lines.push(...early.splice(0).map((invalid) => invalidText(invalid, current)));
    }
    tell(lines);
    const changed = changedNames(before, settings);
    if (!start && changed.length > 0) deps.apply(settings, changed);
    return settings;
  };

  const load = async (start = false) => {
    since = {};
    const read = await loadValues(deps.bridge);
    return take({ ...read, ...since }, start);
  };

  deps.source?.onChange(({ key, value }) => {
    const name = fullKey(key);
    since[name] = value;
    if (started) take({ ...values, [name]: value });
  });
  deps.bridge.onEvent?.((event) => {
    if (event.event !== "settings.invalid" || event.data.owner !== OWNER) return;
    const id = `${event.data.key}\u0000${json(event.data.value)}`;
    if (heard.has(id)) return;
    heard.add(id);
    if (started) tell([invalidText(event.data, current)]);
    else early.push(event.data);
  });

  return {
    /** Read the settings and follow them; resolves with those in force. */
    start: () => load(true),
    /** Read them again (Database: check the clients): a change is applied as one heard. */
    reload: () => load(),
    current: () => current,
  };
}

/**
 * What a change does at once, beyond the next run reading it: a program's setting finds the clients
 * again at their next use, system schemas draw the open explorer's schema lists again (PostgreSQL
 * from its schema cache, the others by reading the list again), and every change reaches the
 * features that follow the settings. What is already read or kept stays as it is.
 * @param {{
 *   clients: { reset(): void },
 *   catalog: { forget(connection?: string, prefix?: string[]): void },
 *   explorer: { reread(connection: string): void },
 *   connections(): Array<{ id: string }>,
 *   features: Iterable<(settings: Settings) => void>,
 * }} deps
 * @returns {Apply}
 */
export function effectsOf(deps) {
  return (next, changed) => {
    if (changed.some((name) => CLIENTS.has(name))) deps.clients.reset();
    if (changed.includes("systemSchemas"))
      for (const conn of deps.connections()) {
        deps.catalog.forget(conn.id, ["schemas"]);
        deps.explorer.reread(conn.id);
      }
    for (const listener of deps.features) listener(next);
  };
}
