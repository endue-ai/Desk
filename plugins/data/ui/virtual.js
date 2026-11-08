// A virtual list: a scrolling element whose rows all have one height, of which only the ones in
// view (and a few around them) are in the DOM, so a tree of any size or a file of millions of lines
// scrolls. Past a few million pixels the scroll position maps onto the rows proportionally.
// Without a layout (a hidden frame, jsdom) it draws a fixed number of rows.

/** The tallest scroll height used; browsers cap element heights near 33 million pixels. */
const MAX_HEIGHT = 8_000_000;
/** Rows drawn when the element has no height to measure. */
const FALLBACK_ROWS = 150;
const OVERSCAN = 8;

/**
 * @param {HTMLElement} scroller The element that scrolls.
 * @param {number} rowHeight
 * @param {(first: number, last: number, top: number) => void} draw Draw rows [first, last) at `top` px.
 */
export function createVirtual(scroller, rowHeight, draw) {
  const doc = /** @type {Document} */ (scroller.ownerDocument);
  const spacer = doc.createElement("div");
  spacer.className = "spacer";
  spacer.setAttribute("role", "none");
  const windowEl = doc.createElement("div");
  windowEl.className = "window";
  windowEl.setAttribute("role", "none");
  spacer.append(windowEl);
  scroller.append(spacer);
  let count = 0;

  const viewport = () => scroller.clientHeight || FALLBACK_ROWS * rowHeight;
  const rowsInView = () => Math.max(1, Math.floor(viewport() / rowHeight));
  const full = () => count * rowHeight;
  const height = () => Math.min(full(), MAX_HEIGHT);
  /** Rows per pixel of scrolling, beyond 1 when the list is taller than MAX_HEIGHT. */
  const scale = () => {
    const room = height() - viewport();
    return full() <= MAX_HEIGHT || room <= 0 ? 1 : (full() - viewport()) / room;
  };
  const firstRow = () =>
    Math.min(Math.max(0, count - 1), Math.floor((scroller.scrollTop * scale()) / rowHeight));

  const render = () => {
    const first = Math.max(0, firstRow() - (scale() === 1 ? OVERSCAN : 0));
    const last = Math.min(count, first + rowsInView() + OVERSCAN * 2);
    const top = scale() === 1 ? first * rowHeight : scroller.scrollTop;
    windowEl.style.transform = `translateY(${top}px)`;
    draw(first, last, top);
  };

  scroller.addEventListener("scroll", render);

  return {
    /** The element the rows go in. */
    window: windowEl,
    render,
    /** @param {number} n */
    setCount(n) {
      count = n;
      spacer.style.height = `${height()}px`;
    },
    /** Scroll so row `index` is in view, a few rows from the top when it was not. */
    reveal(/** @type {number} */ index) {
      const first = firstRow();
      const shown = rowsInView();
      if (index >= first && index < first + shown - 1 && scroller.clientHeight > 0) return;
      const target = Math.max(0, index - Math.min(3, Math.floor(shown / 3)));
      scroller.scrollTop = (target * rowHeight) / scale();
    },
    rowsInView,
  };
}
