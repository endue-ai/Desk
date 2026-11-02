// Continuous pages (PDF, XPS, comics, DjVu): one box per page at its size times the zoom, laid out
// arithmetically so the current page and the visible ones are known without layout (and in
// jsdom). Only pages near the screen are drawn; pages far from it are emptied again, so a long
// file never holds more than a few canvases. Timers, not animation frames: a hidden frame's
// requestAnimationFrame never fires.

/**
 * @typedef {import("./open.js").PagesBook} PagesBook
 * @typedef {import("./marks.js").At} At
 * @typedef {(done: number, total: number) => void} Report
 * @typedef {{ moved(at: At): void, go(unit: number): void, external(url: string): void, reload?(): unknown,
 *   work?(detail: string, run: (signal?: AbortSignal, report?: Report) => Promise<unknown>): Promise<unknown> }} Hooks
 */

const PAD = 16;
const GAP = 12;
const px = (/** @type {number} */ n) => `${Math.round(n * 100) / 100}px`;

/**
 * @param {Document} doc
 * @param {HTMLElement} host The page column (#pages).
 * @param {HTMLElement} scroller The scrolling pane (#doc).
 * @param {Hooks} hooks
 */
export function createPages(doc, host, scroller, hooks) {
  /** @type {PagesBook | null} */
  let book = null;
  let zoom = 1;
  /** @type {HTMLElement[]} */
  let boxes = [];
  /** @type {number[]} */
  let tops = [];
  /** Pages drawn, or being drawn, at the zoom they were drawn for. */
  /** @type {Map<number, { zoom: number, done: Promise<HTMLElement> }>} */
  const drawn = new Map();
  let unit = 0;
  let generation = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let scrolled;
  const stopScroll = () => {
    if (scrolled !== undefined) clearTimeout(scrolled);
    scrolled = undefined;
  };

  const heightOf = (/** @type {number} */ i) => (book?.pages[i]?.height ?? 0) * zoom;
  /** A page that cannot be drawn says so, with the reader's sentence when it has one. */
  const failed = (
    /** @type {HTMLElement} */ box,
    /** @type {number} */ i,
    /** @type {any} */ error,
  ) => {
    box.dataset.failed = "true";
    const why =
      typeof error?.message === "string" && /\.$/.test(error.message) ? ` ${error.message}` : "";
    box.textContent = `Page ${i + 1} could not be drawn.${why}`;
  };
  const layout = () => {
    tops = [];
    let y = PAD;
    for (const [i, box] of boxes.entries()) {
      const size = book?.pages[i] ?? { width: 0, height: 0 };
      box.style.width = px(size.width * zoom);
      box.style.height = px(size.height * zoom);
      tops.push(y);
      y += size.height * zoom + GAP;
    }
  };
  /** The page at a vertical position of the column. */
  const pageAt = (/** @type {number} */ y) => {
    let lo = 0;
    let hi = tops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((tops[mid] ?? 0) <= y) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, lo);
  };
  const where = () => {
    const y = scroller.scrollTop;
    const i = pageAt(y + Math.max(PAD, Math.min(scroller.clientHeight / 3, 120)));
    const h = heightOf(i) || 1;
    return { unit: i, offset: Math.max(0, Math.min(1, (y - (tops[i] ?? 0)) / h)) };
  };

  /** Draw page `i` (again, when the zoom changed for a PDF or DjVu), and measure it first. */
  const draw = (/** @type {number} */ i) => {
    const box = boxes[i];
    const current = drawn.get(i);
    if (!book || !box) return Promise.resolve(box ?? host);
    const scaled = book.format === "PDF" || book.scaled === true;
    if (current && (current.zoom === zoom || !scaled)) return current.done;
    const mine = generation;
    const target = book;
    const work = hooks.work ?? ((_detail, run) => run());
    const done = work(`Page ${i + 1}`, async (signal, progress) => {
      const release = target.beginDecode?.(signal);
      try {
        const before = target.pages[i];
        const size =
          (await target.measure?.(i, signal, progress).catch((error) => {
            if (signal?.aborted || target.stopped?.()) throw error;
            return before;
          })) ?? before;
        if (mine !== generation) return box;
        if (size && before && (size.width !== before.width || size.height !== before.height)) {
          const at = where();
          layout();
          if (i < at.unit) goTo(at.unit, at.offset, false);
        }
        signal?.throwIfAborted();
        await target
          .paint(i, box, zoom, { go: hooks.go, external: hooks.external, signal, progress })
          .catch((error) => {
            if (signal?.aborted || target.stopped?.() || error?.name === "AbortError") throw error;
            failed(box, i, error);
          });
        box.dataset.drawn = "true";
        return box;
      } finally {
        release?.();
      }
    }).catch((error) => {
      if (target.stopped?.() && mine === generation) {
        box.dataset.cancelled = "true";
        box.replaceChildren(doc.createTextNode(`${target.format} decoding stopped. `));
        const retry = doc.createElement("button");
        retry.type = "button";
        retry.textContent = "Reload document";
        retry.addEventListener("click", () => hooks.reload?.());
        box.append(retry);
      } else if (error?.name !== "AbortError") failed(box, i, error);
      if (mine === generation && drawn.get(i)?.done === done) drawn.delete(i);
      return box;
    });
    drawn.set(i, { zoom, done });
    return done;
  };

  /** Draw what is on screen and one page either side; empty pages far away. */
  const refresh = () => {
    if (!book) return;
    const top = scroller.scrollTop;
    const view = scroller.clientHeight || heightOf(unit) || 1;
    const first = Math.max(0, pageAt(top) - 1);
    const last = Math.min(boxes.length - 1, pageAt(top + view) + 1);
    for (let i = first; i <= last; i++) void draw(i);
    for (const [i] of drawn) {
      if (i >= first - 4 && i <= last + 4) continue;
      drawn.delete(i);
      boxes[i]?.replaceChildren();
      if (boxes[i]) delete boxes[i].dataset.drawn;
    }
  };

  const report = () => {
    const at = where();
    unit = at.unit;
    hooks.moved(at);
  };

  scroller.addEventListener(
    "scroll",
    () => {
      if (!book) return;
      if (scrolled !== undefined) clearTimeout(scrolled);
      scrolled = setTimeout(() => {
        scrolled = undefined;
        refresh();
        report();
      }, 60);
    },
    { passive: true },
  );

  /** @param {number} i @param {number} [offset] @param {boolean} [tell] */
  function goTo(i, offset = 0, tell = true) {
    if (!book) return;
    const page = Math.max(0, Math.min(boxes.length - 1, i));
    unit = page;
    scroller.scrollTop = Math.max(
      0,
      (tops[page] ?? 0) + offset * heightOf(page) - (offset ? 0 : PAD / 2),
    );
    refresh();
    if (tell) hooks.moved({ unit: page, offset });
  }

  /** The zoom at which the widest page, or the current page whole, fits the pane. */
  const fit = (/** @type {"width" | "page"} */ how) => {
    const pages = book?.pages ?? [];
    const width = scroller.clientWidth - PAD * 2;
    if (!pages.length || width <= 0) return 1;
    const wide = Math.max(...pages.map((p) => p.width));
    const byWidth = width / wide;
    if (how === "width") return byWidth;
    const page = pages[unit] ?? pages[0] ?? { width: 1, height: 1 };
    return Math.min(byWidth, (scroller.clientHeight - PAD * 2) / page.height || byWidth);
  };

  return {
    /** @param {PagesBook} next @param {{ at: At, zoom: number | null }} start */
    load(next, start) {
      stopScroll();
      generation++;
      book = next;
      drawn.clear();
      boxes = next.pages.map((_, i) => {
        const box = doc.createElement("section");
        box.className = "page";
        box.setAttribute("aria-label", `Page ${i + 1}`);
        box.dataset.unit = String(i);
        return box;
      });
      host.replaceChildren(...boxes);
      zoom = start.zoom ?? Math.min(fit("width"), 1.25);
      layout();
      goTo(start.at.unit, start.at.offset, false);
      return zoom;
    },
    clear() {
      stopScroll();
      generation++;
      book = null;
      boxes = [];
      drawn.clear();
      host.replaceChildren();
    },
    goTo,
    /** Change the zoom, keeping the current place on screen. */
    zoom(/** @type {number} */ next) {
      const at = where();
      zoom = next;
      layout();
      goTo(at.unit, at.offset, false);
      return zoom;
    },
    fit,
    current: () => (book ? where() : { unit: 0, offset: 0 }),
    /** The page drawn, for search: its text layer is there once this resolves. */
    drawn: (/** @type {number} */ i) => draw(i),
    count: () => boxes.length,
  };
}
