// The plugin's settings, from `init.get` (the layer the core serves today) over the defaults the
// manifest declares. Settings the core serves later (`settings.*`) slot in here.

/**
 * @typedef {{ logCount: number, diffContext: number, signOff: boolean, pullRebase: boolean, confirm: boolean, recentMax: number }} Settings
 */

/** @type {Settings} */
export const DEFAULTS = Object.freeze({
  logCount: 200,
  diffContext: 3,
  signOff: false,
  pullRebase: false,
  confirm: true,
  recentMax: 10,
});

/** The manifest key of each setting. */
const KEYS = {
  logCount: "endue.git.log-count",
  diffContext: "endue.git.diff-context",
  signOff: "endue.git.sign-off",
  pullRebase: "endue.git.pull-rebase",
  confirm: "endue.git.confirm",
  recentMax: "endue.git.recent-max",
};

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 * @returns {Promise<Settings>}
 */
export async function loadSettings(bridge) {
  const init = await bridge.call("init.get", {}).catch(() => ({ settings: {} }));
  return fromValues(init.settings ?? {});
}

/**
 * Typed settings from raw values; a value of the wrong type keeps the default.
 * @param {Record<string, unknown>} values
 * @returns {Settings}
 */
export function fromValues(values) {
  /** @type {Settings} */
  const settings = { ...DEFAULTS };
  for (const [name, key] of Object.entries(KEYS)) {
    const value = values[key];
    const field = /** @type {keyof Settings} */ (name);
    if (typeof value === typeof DEFAULTS[field] && value !== undefined) {
      if (typeof value === "number" && !(Number.isInteger(value) && value > 0)) continue;
      // @ts-expect-error the type was checked against the default's
      settings[field] = value;
    }
  }
  return settings;
}
