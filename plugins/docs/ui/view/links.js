// A document's links leave the desk through shell.open, which checks the scheme and the grant in
// the core and asks the person once by itself. Only http, https and mailto are handed over;
// anything else (javascript:, file:, data:, a bookmark) opens nothing. A refusal is final for that
// click: no second ask and no retry.

/** @type {import("@endue-ai/bridge").ShellOpenPermission} */
export const SHELL_SCOPE = { permission: "shell:open", schemes: ["http", "https", "mailto"] };
const SCHEMES = ["http:", "https:", "mailto:"];

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 * @returns {(input: string) => Promise<boolean>} true when the link was handed over
 */
export function createLinks(bridge) {
  return async (input) => {
    let url;
    try {
      url = new URL(input);
    } catch {
      return false;
    }
    if (!SCHEMES.includes(url.protocol)) return false;
    await bridge.call("shell.open", { target: url.href, scope: SHELL_SCOPE });
    return true;
  };
}
