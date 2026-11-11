// The refusals the person made this session. The core remembers each one (CORE-03) and answers the
// same request refused at once until a grant covers it, so a mis-click would hold for the rest of the
// session; listed here, a refusal is taken back with Allow, which grants what was asked for as long
// as it was asked (perm.grant) and so ends the core's refusal too. Plain data in, plain data out.
import { describeCaller, describePermission, durationLabel } from "./describe.js";

/**
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("@endue-ai/bridge").GrantDuration} GrantDuration
 * @typedef {import("@endue-ai/bridge").CallerGrant} CallerGrant
 * @typedef {import("@endue-ai/bridge").PluginInfo} PluginInfo
 * @typedef {import("./describe.js").Caller} Caller
 * @typedef {{ caller: string, permission: Permission, duration: GrantDuration }} Refusal
 * @typedef {{ key: string, caller: Caller, permission: string, scope: string, duration: string,
 *   allowLabel: string }} RefusalItem
 */

/** A value with its object keys in order, so two equal permissions print the same. */
const ordered = (/** @type {unknown} */ value) => {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([key, inner]) => [key, ordered(inner)]));
};

/** Who was refused what: one key per caller and permission, scope included, as the core keys it. */
export const refusalKey = (/** @type {{ caller: string, permission: Permission }} */ refusal) =>
  `${refusal.caller}\n${JSON.stringify(ordered(refusal.permission))}`;

const isRefusal = (/** @type {any} */ value) =>
  typeof value?.caller === "string" &&
  typeof value?.permission?.permission === "string" &&
  ["once", "session", "always"].includes(value?.duration);

/**
 * The refusals of this session, oldest first, starting from what the plugin kept before its page
 * loaded again.
 * @param {unknown} saved
 */
export function createRefusals(saved) {
  /** @type {Refusal[]} */
  let list = Array.isArray(saved) ? saved.filter(isRefusal) : [];
  return {
    all: () => list,
    /** @param {Refusal} refusal */
    add(refusal) {
      const key = refusalKey(refusal);
      list = [...list.filter((r) => refusalKey(r) !== key), refusal];
    },
    /** @param {string} key @returns {Refusal | undefined} */
    find: (key) => list.find((r) => refusalKey(r) === key),
    /** @param {string} key */
    remove(key) {
      list = list.filter((r) => refusalKey(r) !== key);
    },
    /**
     * Drop the refusals a grant of the same permission to the same caller ended; whether any went.
     * @param {CallerGrant[]} grants
     */
    prune(grants) {
      const held = new Set(grants.map(({ caller, grant }) => refusalKey({ caller, ...grant })));
      const before = list.length;
      list = list.filter((r) => !held.has(refusalKey(r)));
      return list.length !== before;
    },
  };
}

/**
 * The refusals in words, each with the label of its Allow button.
 * @param {Refusal[]} refusals
 * @param {PluginInfo[]} plugins
 * @returns {RefusalItem[]}
 */
export function refusalItems(refusals, plugins) {
  return refusals.map((refusal) => {
    const caller = describeCaller(refusal.caller, plugins);
    const { label, scope } = describePermission(refusal.permission);
    const duration = durationLabel(refusal.duration);
    const what = `${label}${scope ? ` (${scope})` : ""}`;
    return {
      key: refusalKey(refusal),
      caller,
      permission: label,
      scope,
      duration,
      allowLabel: `Allow ${what} for ${caller.name} (${duration})`,
    };
  });
}
