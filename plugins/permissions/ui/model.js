// What the view shows, built from bridge data: the grant list grouped by caller and the prompt in
// front. Plain data in, plain data out; the accessible names are part of the model so tests read them.
import { broadWarning, describeCaller, describePermission, durationLabel } from "./describe.js";

/**
 * @typedef {import("@endue-ai/bridge").CallerGrant} CallerGrant
 * @typedef {import("@endue-ai/bridge").PermPromptData} PermPromptData
 * @typedef {import("@endue-ai/bridge").PluginInfo} PluginInfo
 * @typedef {import("./describe.js").Caller} Caller
 * @typedef {{ grantId: string, permission: string, scope: string, duration: string,
 *   warning: string | null, revokeLabel: string }} GrantItem
 * @typedef {{ caller: Caller, grants: GrantItem[] }} GrantGroup
 * @typedef {{ summary: string, groups: GrantGroup[] }} GrantList
 * @typedef {{ promptId: string, title: string, caller: Caller, permission: string, scope: string,
 *   reason: string, duration: string, warning: string | null, waiting: number }} PromptModel
 */

const count = (/** @type {number} */ n, /** @type {string} */ noun) =>
  `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * Every grant, one group per caller, callers by name then id, grants in the core's order (oldest first).
 * @param {CallerGrant[]} grants
 * @param {PluginInfo[]} plugins
 * @returns {GrantList}
 */
export function grantList(grants, plugins) {
  /** @type {Map<string, GrantGroup>} */
  const groups = new Map();
  for (const { caller, grant } of grants) {
    let group = groups.get(caller);
    if (!group) {
      group = { caller: describeCaller(caller, plugins), grants: [] };
      groups.set(caller, group);
    }
    const { label, scope } = describePermission(grant.permission);
    group.grants.push({
      grantId: grant.grantId,
      permission: label,
      scope,
      duration: durationLabel(grant.duration),
      warning: broadWarning(grant.permission),
      revokeLabel: `Revoke ${label}${scope ? ` (${scope})` : ""} from ${group.caller.name}`,
    });
  }
  const sorted = [...groups.values()].sort(
    (a, b) => a.caller.name.localeCompare(b.caller.name) || a.caller.id.localeCompare(b.caller.id),
  );
  const summary =
    grants.length === 0
      ? "Nobody holds a permission."
      : `${count(grants.length, "permission")} held by ${count(sorted.length, "caller")}`;
  return { summary, groups: sorted };
}

/**
 * The prompt in front of the queue, with how many wait behind it.
 * @param {PermPromptData} prompt
 * @param {PluginInfo[]} plugins
 * @param {number} waiting
 * @returns {PromptModel}
 */
export function promptModel(prompt, plugins, waiting) {
  const caller = describeCaller(prompt.caller, plugins);
  const { label, scope } = describePermission(prompt.permission);
  return {
    promptId: prompt.promptId,
    title: `${caller.name} asks for permission`,
    caller,
    permission: label,
    scope,
    reason: prompt.reason,
    duration: durationLabel(prompt.duration),
    warning: broadWarning(prompt.permission),
    waiting,
  };
}
