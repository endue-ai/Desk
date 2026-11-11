// Where the person is in the pages, and going back there: the page at the top of the view, how far
// down that page the view's top edge is and how far across the sheet its left edge is, each a share
// rather than pixels, since a page not drawn yet has only its estimated height (content-visibility).

/** @typedef {import("../keep.js").At} At */

const share = (/** @type {number} */ part, /** @type {number} */ whole) =>
  whole > 0 ? Math.max(0, Math.min(1, part / whole)) : 0;

/** Each page's top and height in the desk's scrolled content. */
const boxes = (/** @type {HTMLElement} */ desk, /** @type {HTMLElement} */ sheet) => {
  const origin = desk.getBoundingClientRect().top - desk.scrollTop;
  return Array.from(sheet.children, (page) => {
    const box = page.getBoundingClientRect();
    return { top: box.top - origin, height: box.height };
  });
};

/**
 * Where the view is in the pages, or null with none drawn.
 * @param {HTMLElement} desk the scrolling view
 * @param {HTMLElement} sheet the pages
 * @returns {At | null}
 */
export function whereIn(desk, sheet) {
  const pages = boxes(desk, sheet);
  if (pages.length === 0) return null;
  const top = desk.scrollTop;
  let page = 0;
  while (page + 1 < pages.length && (pages[page + 1]?.top ?? 0) <= top + 0.5) page++;
  const box = pages[page] ?? { top: 0, height: 0 };
  const wide = desk.scrollWidth > desk.clientWidth;
  return {
    page,
    down: share(top - box.top, box.height),
    across: wide ? share(desk.scrollLeft, desk.scrollWidth) : 0,
  };
}

/**
 * Scroll the view to `at`, or to the start without one. The page there is laid out for it first: a
 * page never drawn has only its estimated height, and a share of that is not where the person was.
 * Its pictures may still change its height, so the view is put there again on the next frame.
 * @param {HTMLElement} desk
 * @param {HTMLElement} sheet
 * @param {At | null} at
 */
export function goTo(desk, sheet, at) {
  const page = at ? sheet.children[Math.min(at.page, sheet.children.length - 1)] : undefined;
  const put = () => {
    const style = page instanceof HTMLElement ? page.style : undefined;
    if (style) style.contentVisibility = "visible";
    const pages = boxes(desk, sheet);
    const box = at ? pages[Math.min(at.page, pages.length - 1)] : undefined;
    desk.scrollTop = box && at ? box.top + at.down * box.height : 0;
    desk.scrollLeft = at ? at.across * desk.scrollWidth : 0;
    // On screen now, the page stays drawn, so its height stays what it was measured at.
    if (style) style.contentVisibility = "";
  };
  put();
  const win = desk.ownerDocument.defaultView;
  if (at && typeof win?.requestAnimationFrame === "function") win.requestAnimationFrame(put);
}
