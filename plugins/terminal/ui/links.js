// Links in the terminal (TERM-E07): OSC 8 hyperlinks (xterm's linkHandler) and URLs in plain text
// (the web links addon) open in the system's browser or mail app through shell.open, on Mod+click
// so that a click that selects text never opens one. Only http, https and mailto ever open: the
// manifest's shell:open scope names those, and the core opens nothing else whatever a scope says.
// No DOM.

/** @typedef {import("./shell.js").Platform} Platform */

export const LINKS = Object.freeze({
  permission: "shell:open",
  schemes: Object.freeze(["http", "https", "mailto"]),
});

const SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** The link if it may open, else null. */
function openable(/** @type {string} */ uri) {
  try {
    return SCHEMES.has(new URL(uri).protocol) ? uri : null;
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   bridge: { call(method: "shell.open", params: object): Promise<unknown> },
 *   say(text: string): void,
 *   platform: Platform,
 * }} deps
 */
export function createLinks({ bridge, say, platform }) {
  const hint = (/** @type {string} */ uri) =>
    `${platform === "mac" ? "⌘" : "Ctrl"}-click to open ${uri}`;
  const modified = (/** @type {MouseEvent} */ event) =>
    platform === "mac" ? event.metaKey : event.ctrlKey;

  /** Open `uri` on Mod+click; a plain click says how. */
  const open = async (/** @type {MouseEvent} */ event, /** @type {string} */ uri) => {
    const target = openable(uri);
    if (!target) {
      say("Only http, https and mailto links open.");
      return false;
    }
    if (!modified(event)) {
      say(hint(target));
      return false;
    }
    try {
      await bridge.call("shell.open", {
        target,
        scope: { permission: LINKS.permission, schemes: [...LINKS.schemes] },
      });
      return true;
    } catch (error) {
      const code = /** @type {{ code?: string }} */ (error)?.code ?? "error";
      say(
        code === "permission_denied"
          ? "Not allowed to open links."
          : `Could not open the link: ${code}.`,
      );
      return false;
    }
  };

  return {
    open,
    /** xterm's linkHandler, for OSC 8 hyperlinks (mailto is not http, so it is allowed here). */
    handler: {
      allowNonHttpProtocols: true,
      activate: open,
      hover: (/** @type {MouseEvent} */ _event, /** @type {string} */ uri) => {
        const target = openable(uri);
        if (target) say(hint(target));
      },
      leave: (/** @type {MouseEvent} */ _event, /** @type {string} */ _uri) => say(""),
    },
  };
}
