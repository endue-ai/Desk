// shell.open performs its own check-or-ask in the core. A refusal is final for this click: do not
// issue a second permission request or retry the URL behind the person's answer.
const scope = { permission: "shell:open", schemes: ["http", "https", "mailto"] };
export function createLinks(bridge) {
  return async (input) => {
    let url;
    try {
      url = new URL(input);
    } catch {
      return;
    }
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return;
    await bridge.call("shell.open", { url: url.href, scope });
  };
}
