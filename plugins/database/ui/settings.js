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

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 * @returns {Promise<Settings>}
 */
export async function loadSettings(bridge) {
  const init = await bridge.call("init.get", {}).catch(() => ({ settings: {} }));
  return fromValues(init.settings ?? {});
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
