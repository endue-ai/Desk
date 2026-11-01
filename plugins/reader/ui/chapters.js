// Reflowed books (EPUB, MOBI, FB2): one chapter at a time in a shadow root, with the book's own CSS
// scoped to it and a paper-like base style under it. Links inside the book jump (through the
// book's target()), links out of it are not followed from the sandboxed frame. The position is
// the chapter and how far down it the pane is scrolled.
import { loadFonts } from "./paint.js";

/**
 * @typedef {import("./open.js").ChaptersBook} ChaptersBook
 * @typedef {import("./open.js").Target} Target
 * @typedef {import("./marks.js").At} At
 * @typedef {{ moved(at: At): void, go(target: Target): void, external(url: string): void, work?(detail: string, run: (signal?: AbortSignal) => Promise<unknown>): Promise<any> }} Hooks
 */

const BASE = `:host { display: block; color: #1d1b1f; background: #fbfaf7; }
.reader-column { box-sizing: border-box; max-width: 46em; margin: 0 auto; padding: 2em 2.5em 3em; font: 1.06rem/1.65 Georgia, "Iowan Old Style", "Noto Serif", serif; overflow-wrap: break-word; }
img, svg, video { max-width: 100%; height: auto; }
a { color: #4b3aa8; } a.external { text-decoration: underline dotted; }
pre { white-space: pre-wrap; } table { border-collapse: collapse; max-width: 100%; }
mark.hit { background: #ffe08a; color: inherit; } mark.hit.current { background: #ff9f43; outline: 2px solid #b35900; }`;

/**
 * @param {HTMLElement} host The chapter element (#chapter); its shadow root holds the text.
 * @param {HTMLElement} scroller The scrolling pane (#doc).
 * @param {Hooks} hooks
 */
export function createChapters(host, scroller, hooks) {
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  /** @type {ChaptersBook | null} */
  let book = null;
  /** The book whose chapter `unit` is in the shadow root now. */
  /** @type {ChaptersBook | null} */
  let showing = null;
  let unit = 0;
  let generation = 0;
  let displayedGeneration = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let scrolled;
  const stopScroll = () => {
    if (scrolled !== undefined) clearTimeout(scrolled);
    scrolled = undefined;
  };

  const offset = () => {
    const room = scroller.scrollHeight - scroller.clientHeight;
    return room > 0 ? Math.max(0, Math.min(1, scroller.scrollTop / room)) : 0;
  };

  const follow = (event) => {
    if (
      event.type === "keydown" &&
      (event.key !== "Enter" || !event.target?.closest?.("a.external"))
    )
      return;
    const link = /** @type {Element | null} */ (
      event.target instanceof Element ? event.target : null
    )?.closest("a");
    if (!link || !book) return;
    event.preventDefault();
    const href = link.getAttribute("href");
    if (href) {
      const target = book.target(href, unit);
      if (target) hooks.go(target);
    } else if (link.classList.contains("external"))
      hooks.external(link.getAttribute("title") ?? "");
  };
  root.addEventListener("click", follow);
  root.addEventListener("keydown", follow);

  scroller.addEventListener(
    "scroll",
    () => {
      if (!book || displayedGeneration !== generation) return;
      if (scrolled !== undefined) clearTimeout(scrolled);
      scrolled = setTimeout(() => {
        scrolled = undefined;
        hooks.moved({ unit, offset: offset() });
      }, 120);
    },
    { passive: true },
  );

  /** Scroll to an anchor in the chapter, or to a fraction of it. */
  const place = (/** @type {{ anchor?: string, offset?: number }} */ to) => {
    const id = to.anchor;
    const found = id
      ? [...root.querySelectorAll("[id], [data-aid]")].find(
          (el) => el.id === id || el.getAttribute("data-aid") === id,
        )
      : undefined;
    if (found) {
      found.scrollIntoView?.({ block: "start" });
      if (!found.scrollIntoView)
        scroller.scrollTop = /** @type {HTMLElement} */ (found).offsetTop ?? 0;
    } else
      scroller.scrollTop =
        (to.offset ?? 0) * Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  };

  return {
    /**
     * Show chapter `i`; resolves with the shadow root, for search, once its text is in.
     * @param {ChaptersBook} next
     * @param {number} i
     * @param {{ anchor?: string, offset?: number }} [to]
     */
    async show(next, i, to = {}) {
      stopScroll();
      const mine = ++generation;
      book = next;
      const target = Math.max(0, Math.min(next.chapters.length - 1, i));
      if (target === unit && showing === next) {
        displayedGeneration = mine;
        place(to);
        return root;
      }
      const work = hooks.work ?? ((_detail, run) => run());
      const chapter = await work(`Chapter ${target + 1}`, (signal) =>
        next.chapter(target, signal),
      ).catch((error) =>
        error?.name === "AbortError"
          ? null
          : {
              html: `<div class="body"><p>This chapter could not be shown: ${String(error?.message ?? error).replace(/[<&]/g, "")}</p></div>`,
              css: [],
              fonts: [],
            },
      );
      if (!chapter) return root;
      if (mine !== generation) return root;
      await loadFonts(host.ownerDocument, chapter.fonts);
      if (mine !== generation) return root;
      unit = target;
      showing = next;
      displayedGeneration = mine;
      // The book's own body rules apply to its .body; the reading column around it is the reader's.
      root.innerHTML = [
        `<style>${BASE}</style>`,
        ...chapter.css.map((css) => `<style>${css.replace(/<\/style/gi, "")}</style>`),
        `<div class="reader-column">${chapter.html}</div>`,
      ].join("");
      place(to);
      return root;
    },
    clear() {
      stopScroll();
      generation++;
      book = null;
      showing = null;
      root.replaceChildren();
    },
    zoom(/** @type {number} */ z) {
      host.style.setProperty("zoom", String(z));
      return z;
    },
    current: () => ({ unit, offset: offset() }),
    root: () => root,
  };
}
