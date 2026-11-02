// The page surface: a shadow root that holds one sanitized page at a time. Each page is prepared
// once (page.js) and kept while its file is open, so switching back is instant; a page goes on
// screen as soon as its sheets are ready and fills in as it is copied, and a huge page's rest is
// copied as it is scrolled to (or jumped to). Clicks on links and form submissions never reach
// the browser: the view decides what a link does.
import { startPage } from "./page.js";

/**
 * @typedef {import("./formats.js").PageInput} PageInput
 * @typedef {import("./page.js").PreparedPage} PreparedPage
 * @typedef {import("./page.js").PageOptions} PageOptions
 * @typedef {{ nodes: HTMLElement, title: string, left: PreparedPage["left"], empty: boolean,
 *   scroll: number, painted?: boolean, fill(): Promise<void>, more(): Promise<void>,
 *   all(): Promise<void>, done(): boolean }} Drawn
 * @typedef {Pick<PageOptions, "signal" | "progress">} Job
 */

const isAbort = (/** @type {unknown} */ error) =>
  /** @type {{ name?: string } | null} */ (error)?.name === "AbortError";

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

/**
 * @param {Document} doc
 * @param {HTMLElement} host the element the shadow root is attached to; it scrolls
 * @param {{ link(href: string): void, submitted(): void }} on
 * @param {{ sliceOver?: number, first?: number }} [options] pages longer than sliceOver are parsed
 *   in slices; first elements are copied before a page counts as drawn
 */
export function createPageView(doc, host, on, options = {}) {
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
  // Near the end of what is copied of a huge page, copy the next part.
  let extending = false;
  host.addEventListener("scroll", async () => {
    const drawn = current?.drawn;
    if (extending || !drawn || drawn.done()) return;
    if (host.scrollHeight - host.scrollTop > host.clientHeight * 4) return;
    extending = true;
    await drawn.more().finally(() => {
      extending = false;
    });
  });

  /** A page stopped halfway is prepared again the next time it is drawn. @param {PageInput} input */
  const drop = (input, /** @type {Promise<Drawn>} */ pending) => {
    if (cache.get(input) === pending) cache.delete(input);
  };

  /** @param {PageInput} input @param {Job} [job] @returns {Promise<Drawn>} */
  const prepare = (input, job) => {
    let pending = cache.get(input);
    if (!pending) {
      const page = startPage(input, doc, { ...job, ...options });
      pending = page.then(
        (page) => {
          const nodes = doc.createElement("div");
          nodes.append(page.root);
          /** @type {Promise<void> | undefined} */
          let filled;
          /** @type {Drawn} */
          const drawn = {
            nodes,
            title: page.title,
            left: page.left,
            empty: false,
            scroll: 0,
            more: page.more,
            all: page.all,
            done: page.done,
            fill: () => {
              filled ??= page.fill().then(
                (empty) => {
                  drawn.empty = empty;
                },
                (error) => {
                  drop(input, /** @type {Promise<Drawn>} */ (pending));
                  throw error;
                },
              );
              return filled;
            },
          };
          return drawn;
        },
        (error) => {
          if (isAbort(error)) {
            drop(input, /** @type {Promise<Drawn>} */ (pending));
            throw error;
          }
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
            fill: async () => {},
            more: async () => {},
            all: async () => {},
            done: () => true,
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
    /**
     * Draw a page (prepared once), or nothing; null when another draw took over. The job's signal
     * stops a page still being prepared, which rejects with an AbortError.
     * @param {PageInput | null} input @param {Job} [job]
     */
    async draw(input, job) {
      const ticket = ++drawing;
      if (current && current.input === input) {
        await current.drawn.fill();
        return ticket === drawing ? current.drawn : null;
      }
      if (!input) {
        stash();
        return null;
      }
      // What is on screen stays until the new page's sheets and wrappers are ready.
      const drawn = await prepare(input, job);
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
      await drawn.fill();
      return ticket === drawing ? drawn : null;
    },
    /**
     * Scroll to an element of the page by its id or name; the top for an empty fragment. A target
     * past what is copied of a huge page is copied first.
     */
    async scrollTo(/** @type {string} */ fragment) {
      let id = fragment;
      try {
        id = decodeURIComponent(fragment);
      } catch {}
      const named = () =>
        [...shadow.querySelectorAll("a[name]")].find((a) => a.getAttribute("name") === id);
      const find = () => (id ? (shadow.getElementById(id) ?? named()) : undefined);
      let target = find();
      const drawn = current?.drawn;
      if (!target && id && drawn && !drawn.done()) {
        await drawn.all();
        if (current?.drawn !== drawn) return;
        target = find();
      }
      if (target) target.scrollIntoView?.({ block: "start" });
      else if (!id || id.toLowerCase() === "top") host.scrollTop = 0;
    },
  };
}
