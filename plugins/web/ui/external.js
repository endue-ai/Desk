// Links out of the desk: http, https and mailto go to the system's browser or mail app with
// shell.open, under one shell:open scope. shell.open asks the person by itself the first time; a
// refusal is final for that click: no second ask, no retry. Every other scheme opens nothing.

/** @type {import("@endue-ai/bridge").ShellOpenPermission} */
const SCOPE = { permission: "shell:open", schemes: ["http", "https", "mailto"] };
const SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** The URL shell.open would take, or undefined when the link must not leave the desk. */
export function externalUrl(/** @type {string | undefined} */ input) {
  if (!input) return undefined;
  try {
    const url = new URL(input);
    return SCHEMES.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 * @returns {(input: string) => Promise<boolean>} true when the link went to shell.open
 */
export function createExternal(bridge) {
  return async (input) => {
    const target = externalUrl(input);
    if (!target) return false;
    await bridge.call("shell.open", { target, scope: SCOPE });
    return true;
  };
}
