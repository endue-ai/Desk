// The page surface: a shadow root that holds one sanitized page at a time. Each page is prepared
// once (page.js) and kept while its file is open, so switching back is instant. Clicks on links
// and form submissions never reach the browser: the view decides what a link does.
import { preparePage } from "./page.js";

/**
 * @typedef {import("./formats.js").PageInput} PageInput
 * @typedef {import("./page.js").PreparedPage} PreparedPage
 * @typedef {{ nodes: HTMLElement, title: string, left: PreparedPage["left"], empty: boolean,
 *   scroll: number, painted?: boolean }} Drawn
 */

const BACKGROUND = ["color", "image", "repeat", "position", "size", "attachment", "origin", "clip"];

/**
 * As a browser paints the canvas with the body's background when the root has none, move the
 * body's background to the html wrapper, which fills the page's box.
 * @param {ShadowRoot} shadow @param {Window | null} view
 */
function paintCanvas(shadow, view) {
  const html = /** @type {HTMLElement | null} */ (shadow.querySelector("web-html"));
  const body = /** @type {HTMLElement | null} */ (html?.querySelector(":scope > web-body") ?? null);
  if (!html || !body || !view) return;
  const root = view.getComputedStyle(html);
  const clear = (/** @type {string} */ colour) =>
    colour === "transparent" || /^rgba\(.*,\s*0\)$/.test(colour);
  if (root.backgroundImage && root.backgroundImage !== "none") return;
  if (root.backgroundColor && !clear(root.backgroundColor)) return;
  const own = view.getComputedStyle(body);
  if (clear(own.backgroundColor) && (!own.backgroundImage || own.backgroundImage === "none"))
    return;
  for (const part of BACKGROUND) {
    const value = own.getPropertyValue(`background-${part}`);
    if (value) html.style.setProperty(`background-${part}`, value);
  }
  body.style.setProperty("background", "none");
}

/**
 * @param {Document} doc
 * @param {HTMLElement} host the element the shadow root is attached to; it scrolls
 * @param {{ link(href: string): void, submitted(): void }} on
 */
/** An <a> or <area> in the event's path. */
const linkIn = (/** @type {Event} */ event, needsHref = true) =>
  /** @type {Element | undefined} */ (
    event
      .composedPath()
      .find(
        (node) =>
          /** @type {Node} */ (node).nodeType === 1 &&
          /^(a|area)$/.test(/** @type {Element} */ (node).localName) &&
          (!needsHref || /** @type {Element} */ (node).hasAttribute("href")),
      )
  );

export function createPageView(doc, host, on) {
  const shadow = host.attachShadow({ mode: "open" });
  /** Prepared pages by their input, kept in a detached holder while another one is shown. */
  /** @type {WeakMap<PageInput, Promise<Drawn>>} */
  const cache = new WeakMap();
  /** @type {{ input: PageInput, drawn: Drawn } | null} */
  let current = null;

  let drawing = 0;

  shadow.addEventListener("click", (event) => {
    const anchor = linkIn(event);
    if (!anchor) return;
    event.preventDefault();
    on.link(anchor.getAttribute("href") ?? "");
  });
  // A middle click would open a window; a submit would navigate the frame.
  shadow.addEventListener("auxclick", (event) => {
    if (linkIn(event, false)) event.preventDefault();
  });
  shadow.addEventListener("submit", (event) => {
    event.preventDefault();
    on.submitted();
  });

  /** @param {PageInput} input @returns {Promise<Drawn>} */
  const prepare = (input) => {
    let pending = cache.get(input);
    if (!pending) {
      pending = preparePage(input, doc).then(
        (page) => {
          const nodes = doc.createElement("div");
          nodes.append(page.root);
          return { nodes, title: page.title, left: page.left, empty: page.empty, scroll: 0 };
        },
        (error) => {
          const nodes = doc.createElement("div");
          const message = doc.createElement("p");
          message.className = "web-frame";
          message.textContent = `This page could not be drawn: ${error instanceof Error ? error.message : String(error)}`;
          nodes.append(message);
          return {
            nodes,
            title: "",
            left: { remote: 0, missing: 0, limit: 0 },
            empty: false,
            scroll: 0,
          };
        },
      );
      cache.set(input, pending);
    }
    return pending;
  };

  const stash = () => {
    if (!current) return;
    current.drawn.scroll = host.scrollTop;
    current.drawn.nodes.append(...shadow.childNodes);
    current = null;
  };

  return {
    /** Draw a page (prepared once), or nothing. */
    async draw(/** @type {PageInput | null} */ input) {
      const ticket = ++drawing;
      if (current?.input === input) return current.drawn;
      stash();
      if (!input) return null;
      const drawn = await prepare(input);
      // Another page was asked for while this one was prepared: that one wins.
      if (ticket !== drawing) return null;
      stash();
      shadow.append(...drawn.nodes.childNodes);
      if (!drawn.painted) {
        drawn.painted = true;
        paintCanvas(shadow, doc.defaultView);
      }
      current = { input, drawn };
      host.scrollTop = drawn.scroll;
      return drawn;
    },
    /** Scroll to an element of the page by its id or name; the top for an empty fragment. */
    scrollTo(/** @type {string} */ fragment) {
      let id = fragment;
      try {
        id = decodeURIComponent(fragment);
      } catch {}
      const named = () =>
        [...shadow.querySelectorAll("a[name]")].find((a) => a.getAttribute("name") === id);
      const target = id ? (shadow.getElementById(id) ?? named()) : undefined;
      if (target) target.scrollIntoView?.({ block: "start" });
      else if (!id || id.toLowerCase() === "top") host.scrollTop = 0;
    },
  };
}
