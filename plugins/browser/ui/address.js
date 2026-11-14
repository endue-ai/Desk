// What a person typed into the address field, as an address the Browser loads: an http or https
// address as it is, a bare host with https in front (http for this computer and plain numbers,
// which rarely have a certificate), and anything else as words to search for.

/** Where words are searched for when the setting names nothing usable; %s is the words. */
export const SEARCH = "https://duckduckgo.com/?q=%s";

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HOST =
  /^(\[[0-9a-f:]+\]|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(:\d{1,5})?$/i;
const LOCAL = /^(localhost|\[[0-9a-f:]+\]|\d{1,3}(\.\d{1,3}){3})(:\d{1,5})?$/i;

/** An http or https address, whole and well formed, or undefined. */
function web(text) {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Whether `text` reads as a host with an optional path: `example.com/a`, `localhost:3000`. */
function hostLike(text) {
  const host = text.split(/[/?#]/, 1)[0] ?? "";
  if (!HOST.test(host)) return false;
  return LOCAL.test(host) || host.includes(".");
}

/**
 * The address to load for what was typed, or undefined for nothing typed.
 * @param {string} typed
 * @param {string} [search] where words are searched for, with %s for them
 */
export function addressOf(typed, search = SEARCH) {
  const text = typed.trim();
  if (text === "") return undefined;
  if (/^https?:\/\//i.test(text)) return web(text) ?? searchFor(text, search);
  if (!/\s/.test(text) && !SCHEME.test(text.replace(/:\d{1,5}(?=$|[/?#])/, "")) && hostLike(text)) {
    const host = text.split(/[/?#]/, 1)[0] ?? "";
    const made = web(`${LOCAL.test(host) ? "http" : "https"}://${text}`);
    if (made) return made;
  }
  return searchFor(text, search);
}

/** The search for `words`: the setting's page when it is a web address with %s, else the default. */
export function searchFor(words, search = SEARCH) {
  const base = search.includes("%s") && web(search.replace("%s", "x")) ? search : SEARCH;
  return base.replace("%s", encodeURIComponent(words));
}
