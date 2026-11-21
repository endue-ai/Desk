// The plugin's settings, from `init.get` (the layer the core serves today) over the defaults the
// manifest declares. A value of the wrong type or out of range keeps the default.

/**
 * @typedef {{
 *   maxRows: number, timeoutSeconds: number, confirm: boolean, history: boolean, historyMax: number,
 *   systemSchemas: boolean, psql: string, mysql: string, sqlite3: string, path: string[],
 * }} Settings
 */

/** @type {Readonly<Settings>} */
export const DEFAULTS = Object.freeze({
  maxRows: 500,
  timeoutSeconds: 0,
  confirm: true,
  history: true,
  historyMax: 200,
  systemSchemas: false,
  psql: "",
  mysql: "",
  sqlite3: "",
  path: [],
});

/** The manifest key of each setting, and the range of the numbers. */
const KEYS = /** @type {Record<keyof Settings, { key: string, min?: number, max?: number }>} */ ({
  maxRows: { key: "endue.database.max-rows", min: 1, max: 100_000 },
  timeoutSeconds: { key: "endue.database.timeout-seconds", min: 0, max: 86_400 },
  confirm: { key: "endue.database.confirm" },
  history: { key: "endue.database.history" },
  historyMax: { key: "endue.database.history-max", min: 0, max: 1000 },
  systemSchemas: { key: "endue.database.system-schemas" },
  psql: { key: "endue.database.psql" },
  mysql: { key: "endue.database.mysql" },
  sqlite3: { key: "endue.database.sqlite3" },
  path: { key: "endue.database.path" },
});

/** The setting keys as the manifest declares them, in order. */
export const SETTING_KEYS = Object.values(KEYS).map((entry) => entry.key);

const PREFIX = "endue.database.";

/** A key as the manifest names it: settings.list and settings.changed name it without the prefix. */
export const fullKey = (/** @type {string} */ key) =>
  key.startsWith(PREFIX) ? key : `${PREFIX}${key}`;

/**
 * The values in force by manifest key: init.yaml's (init.get), under what settings.list resolves
 * (the default, init.yaml, then what the person set), when the core serves it.
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadValues(bridge) {
  const init = await bridge.call("init.get", {}).catch(() => ({ settings: {} }));
  /** @type {Record<string, unknown>} */
  const values = { ...(init.settings ?? {}) };
  const listed = await bridge.call("settings.list", {}).catch(() => ({ settings: [] }));
  for (const { key, value } of listed.settings ?? []) values[fullKey(key)] = value;
  return values;
}

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 * @returns {Promise<Settings>}
 */
export async function loadSettings(bridge) {
  return fromValues(await loadValues(bridge));
}

/**
 * @param {Record<string, unknown>} values
 * @returns {Settings}
 */
export function fromValues(values) {
  /** @type {Record<string, unknown>} */
  const settings = { ...DEFAULTS };
  for (const [name, { key, min, max }] of Object.entries(KEYS)) {
    const value = values[key];
    const fallback = /** @type {Record<string, unknown>} */ (DEFAULTS)[name];
    if (Array.isArray(fallback)) {
      if (Array.isArray(value) && value.every((v) => typeof v === "string" && v !== ""))
        settings[name] = value;
    } else if (typeof value === "number" && typeof fallback === "number") {
      if (
        Number.isInteger(value) &&
        value >= (min ?? 0) &&
        value <= (max ?? Number.MAX_SAFE_INTEGER)
      )
        settings[name] = value;
    } else if (typeof value === typeof fallback && value !== undefined) settings[name] = value;
  }
  return /** @type {Settings} */ (settings);
}

/** The settings that change which client runs: what was found is found again. */
const CLIENT_KEYS = new Set([KEYS.psql.key, KEYS.mysql.key, KEYS.sqlite3.key, KEYS.path.key]);

/**
 * Follow the settings while the plugin runs (settings.changed for its own keys): each change
 * goes to `apply` with the settings now in force and whether the clients are to be found again.
 * @param {{ onChange(listener: (setting: { key: string, value: unknown }) => void): () => void } | undefined} source
 * @param {Record<string, unknown>} values the values in force at the start (loadValues)
 * @param {(settings: Settings, clients: boolean) => void} apply
 * @returns {() => void} stops following
 */
export function followSettings(source, values, apply) {
  let current = { ...values };
  return (
    source?.onChange(({ key, value }) => {
      const name = fullKey(key);
      current = { ...current, [name]: value };
      apply(fromValues(current), CLIENT_KEYS.has(name));
    }) ?? (() => {})
  );
}
