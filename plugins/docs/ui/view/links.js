// A document's HTTP, HTTPS and mailto links leave the desk through shell.open under its install grant.

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
