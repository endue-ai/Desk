// The plugin's settings, from `init.get` (the layer the core serves today) over the defaults the
// manifest declares. A value of the wrong type or outside its range keeps the default.

/**
 * @typedef {{ context: string, path: string, showAll: boolean, stopTimeout: number, logTail: number, logMax: number,
 *   timestamps: boolean, follow: boolean, statsInterval: number, shell: string, confirm: boolean,
 *   notify: "failures" | "none", revealEnv: boolean }} Settings
 */

/** @type {Settings} */
export const DEFAULTS = Object.freeze({
  context: "",
  path: "",
  showAll: true,
  stopTimeout: 10,
  logTail: 500,
  logMax: 5000,
  timestamps: false,
  follow: true,
  statsInterval: 5,
  shell: "/bin/sh",
  confirm: true,
  notify: "failures",
  revealEnv: false,
});

/** Each setting's manifest key, and the integers' ranges. */
const KEYS = {
  context: "endue.docker.context",
  path: "endue.docker.path",
  showAll: "endue.docker.show-all",
  stopTimeout: "endue.docker.stop-timeout",
  logTail: "endue.docker.log-tail",
  logMax: "endue.docker.log-max",
  timestamps: "endue.docker.timestamps",
  follow: "endue.docker.follow",
  statsInterval: "endue.docker.stats-interval",
  shell: "endue.docker.shell",
  confirm: "endue.docker.confirm",
  notify: "endue.docker.notify",
  revealEnv: "endue.docker.reveal-env",
};

/** @type {Partial<Record<keyof Settings, [number, number]>>} */
const RANGES = {
  stopTimeout: [0, 600],
  logTail: [0, 100_000],
  logMax: [100, 100_000],
  statsInterval: [0, 3600],
};

const CHOICES = { notify: ["failures", "none"] };

/** The setting keys, in the manifest's order. */
export const SETTING_KEYS = Object.values(KEYS);

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 * @returns {Promise<Settings>}
 */
export async function loadSettings(bridge) {
  const init = await bridge.call("init.get", {}).catch(() => ({ settings: {} }));
  return fromValues(init.settings ?? {});
}

/**
 * Typed settings from raw values.
 * @param {Record<string, unknown>} values
 * @returns {Settings}
 */
export function fromValues(values) {
  /** @type {Record<string, unknown>} */
  const settings = { ...DEFAULTS };
  for (const [name, key] of Object.entries(KEYS)) {
    const value = values[key];
    const field = /** @type {keyof Settings} */ (name);
    if (typeof value !== typeof DEFAULTS[field]) continue;
    const range = RANGES[field];
    if (
      range &&
      !(Number.isInteger(value) && Number(value) >= range[0] && Number(value) <= range[1])
    )
      continue;
    const choices = /** @type {Record<string, string[]>} */ (CHOICES)[field];
    if (choices && !choices.includes(String(value))) continue;
    if (field === "shell" && (value === "" || /\s/.test(String(value)))) continue;
    settings[field] = value;
  }
  return /** @type {Settings} */ (settings);
}
