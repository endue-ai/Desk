// The plugin's settings, from `init.get` (the layer the core serves today) over the defaults the
// manifest declares. A value of the wrong type, outside its range or not among its choices keeps
// the default.

import { AGENT_IDS } from "./catalog.js";

/**
 * @typedef {{ path: string, folder: string, access: "read-only" | "agent", timeout: number,
 *   parallel: number, agent: string, confirm: boolean }} Settings
 */

/** @type {Settings} */
export const DEFAULTS = Object.freeze({
  path: "",
  folder: "",
  access: "read-only",
  timeout: 600,
  parallel: 2,
  agent: "",
  confirm: true,
});

/** Each setting's manifest key. */
const KEYS = {
  path: "endue.local-agents.path",
  folder: "endue.local-agents.folder",
  access: "endue.local-agents.access",
  timeout: "endue.local-agents.timeout",
  parallel: "endue.local-agents.parallel",
  agent: "endue.local-agents.agent",
  confirm: "endue.local-agents.confirm",
};

/** @type {Partial<Record<keyof Settings, [number, number]>>} */
export const RANGES = { timeout: [0, 86_400], parallel: [1, 8] };

/** @type {Partial<Record<keyof Settings, readonly string[]>>} */
export const CHOICES = { access: ["read-only", "agent"], agent: ["", ...AGENT_IDS] };

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
    const choices = CHOICES[field];
    if (choices && !choices.includes(String(value))) continue;
    if (field === "path" && String(value).includes("\0")) continue;
    settings[field] = value;
  }
  return /** @type {Settings} */ (settings);
}

/**
 * The folder a command's run works in: `folder` inside `base` (the folder setting, home when empty),
 * relative to it. A path that would leave it (absolute, from ~, a drive, or with ..) is refused.
 * An empty or "." folder is the work folder itself.
 * @param {string} base
 * @param {unknown} folder
 * @returns {string}
 */
export function inside(base, folder) {
  if (typeof folder !== "string") throw new Error("folder is a path relative to the work folder.");
  const parts = folder.split(/[\\/]+/).filter((part) => part !== "" && part !== ".");
  if (/^([\\/~]|[A-Za-z]:)/.test(folder) || parts.includes(".."))
    throw new Error(`${folder} is not inside the work folder: give a folder relative to it.`);
  if (parts.length === 0) return base;
  return [(base || "~").replace(/[\\/]+$/, ""), ...parts].join("/");
}
