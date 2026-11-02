// Links on a slide: the renderer marks a linked run or shape (data-link, role link, its target as
// its title), and the view follows a mark: a jump to a slide stays in the deck, an http, https or
// mailto URL leaves the desk through shell.open, which checks the scheme and the grant in the core
// and asks the person once by itself. Anything else opens nothing; a refusal is final for that click.

/** @type {import("@endue-ai/bridge").ShellOpenPermission} */
export const SHELL_SCOPE = { permission: "shell:open", schemes: ["http", "https", "mailto"] };
const SCHEMES = ["http:", "https:", "mailto:"];

/** The slide a "#slide-N" link jumps to (0-based), or null for a URL. @param {string} link */
export function slideOf(link) {
  const match = /^#slide-(\d+)$/.exec(link);
  return match ? Number(match[1]) - 1 : null;
}

/**
 * Mark `el` as a link. Out of the tab order until the view puts it there: thumbnails draw slides
 * too, inside their buttons. @param {HTMLElement} el @param {string} link
 */
export function markLink(el, link) {
  const slide = slideOf(link);
  if (slide === null && !SCHEMES.some((s) => link.toLowerCase().startsWith(s))) return;
  el.dataset.link = link;
  el.classList.add("link");
  el.setAttribute("role", "link");
  el.tabIndex = -1;
  el.title = slide === null ? link : `Slide ${slide + 1}`;
}

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
