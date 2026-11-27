import { scopeOf } from "./channel.js";

/** @typedef {import("./session.js").Options["bridge"]} Bridge */
/** @typedef {import("./computers.js").Computer} Computer */

export const endpoint = (/** @type {Computer} */ computer) => `${computer.host}:${computer.port}`;

/** @param {unknown} grant @param {Computer} computer */
export function exactGrant(grant, computer) {
  const value =
    /** @type {{ grantId?: unknown, permission?: { permission?: string, hosts?: unknown } }} */ (
      grant
    );
  const scope = value?.permission;
  return typeof value?.grantId === "string" &&
    scope?.permission === "net:connect" &&
    Array.isArray(scope.hosts) &&
    scope.hosts.length === 1 &&
    scope.hosts[0] === endpoint(computer)
    ? value.grantId
    : undefined;
}

/** @param {Bridge} bridge @param {string} grantId */
export async function revoke(bridge, grantId) {
  await bridge.call("perm.revoke", { grantId }).catch((error) => {
    if (/** @type {{ code?: string }} */ (error)?.code !== "not_found") throw error;
  });
}

/** @param {Bridge} bridge @param {Computer} computer */
export async function revokeComputer(bridge, computer) {
  const { grants } = await bridge.call("perm.query", {
    permission: scopeOf(computer.host, computer.port),
  });
  for (const grant of Array.isArray(grants) ? grants : []) {
    const id = exactGrant(grant, computer);
    if (id) await revoke(bridge, id);
  }
}
