// shell.open performs its own check-or-ask in the core. A refusal is final for this click: do not
// issue a second permission request or retry the URL behind the person's answer.
/** @type {import("@endue-ai/bridge").ShellOpenPermission} */
const scope = { permission: "shell:open", schemes: ["http", "https", "mailto"] };
/** @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge */
export function createLinks(bridge) {
  return async (input) => {
    let url;
    try {
      url = new URL(input);
    } catch {
      return;
    }
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return;
    await bridge.call("shell.open", { target: url.href, scope });
  };
}
