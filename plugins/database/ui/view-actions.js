// The header's actions at any width (QA 06 #6): the buttons that fit stay in one row, in their order,
// and the rest are behind More, a <desk-menu> of the same actions, so the row never wraps over the
// console. The row is fitted again whenever its room changes (a resize, a longer title, the busy
// mark, a font that loads). The menu opens under More, kept inside the page, and a long one scrolls.

import { el } from "./dom.js";

/**
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 * @typedef {HTMLElement & { open?: boolean, show?(anchor: HTMLElement): void, close?(): void }} Menu
 *   A <desk-menu>; on a DOM without the element (the unit tests' jsdom) a plain element.
 */

/**
 * How many buttons, `widths` wide in their order, fit in `room` with `gap` between them: all of them
 * when they fit as they are, else as many as fit before a More button `more` wide.
 * @param {number[]} widths
 * @param {number} room
 * @param {number} gap
 * @param {number} more
 */
export function fitCount(widths, room, gap, more) {
  const all = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1);
  if (all <= room) return widths.length;
  let used = more;
  let count = 0;
  for (const width of widths) {
    if (used + gap + width > room) break;
    used += gap + width;
    count++;
  }
  return count;
}

/**
 * @param {Document} doc
 * @param {{ nav: HTMLElement, more: HTMLElement, menu: Menu }} parts
 * @param {Act} act
 */
export function createActions(doc, { nav, more, menu }, act) {
  const buttons = /** @type {HTMLElement[]} */ ([...nav.querySelectorAll(":scope > [data-act]")]);
  // The menu's items say their action in data-action, so the page's [data-act] clicks skip them.
  const items = buttons.map((button) =>
    el(
      doc,
      "div",
      { "data-action": button.dataset.act ?? "", title: button.title || undefined },
      button.textContent ?? "",
    ),
  );
  menu.append(...items);
  const view = doc.defaultView;

  const fit = () => {
    const room = nav.clientWidth;
    if (nav.hidden || room === 0) return;
    for (const button of buttons) button.hidden = false;
    more.hidden = false;
    const width = (/** @type {HTMLElement} */ node) => node.getBoundingClientRect().width;
    const gap = Number.parseFloat(view?.getComputedStyle(nav).columnGap ?? "") || 0;
    const count = fitCount(buttons.map(width), room, gap, width(more));
    buttons.forEach((button, i) => {
      button.hidden = i >= count;
    });
    items.forEach((item, i) => {
      item.hidden = i < count;
    });
    more.hidden = count === buttons.length;
    if (more.hidden && menu.open) menu.close?.();
  };

  /** Under More, its right edges on More's, inside the page; what does not fit scrolls. */
  const place = () => {
    const anchor = more.getBoundingClientRect();
    const page = doc.documentElement;
    const width = menu.getBoundingClientRect().width;
    const left = Math.min(anchor.right - width, page.clientWidth - width - 4);
    menu.style.left = `${Math.max(4, left)}px`;
    menu.style.maxHeight = `${Math.max(60, page.clientHeight - anchor.bottom - 12)}px`;
    menu.style.overflowY = "auto";
  };

  // A press on More while the menu is open closes it (the menu's own press outside), and the click
  // that follows must not open it again: whether it was open is read before the menu hears it.
  let toggled = false;
  doc.addEventListener(
    "pointerdown",
    (event) => {
      toggled = Boolean(menu.open) && more.contains(/** @type {Node} */ (event.target));
    },
    true,
  );
  more.addEventListener("click", () => {
    if (toggled || menu.open) {
      toggled = false;
      return menu.close?.();
    }
    // Cancel is off while nothing runs, as its button is.
    for (const item of items)
      if (item.dataset.action === "cancel")
        item.setAttribute("aria-disabled", String(doc.body.dataset.running !== "true"));
    menu.show?.(more);
    place();
  });
  menu.addEventListener("desk-select", (event) => {
    const item = /** @type {CustomEvent<{ item: HTMLElement }>} */ (event).detail.item;
    act(item.dataset.action ?? "");
  });
  if (view && "ResizeObserver" in view) new view.ResizeObserver(fit).observe(nav);
  // A font that arrives later makes the buttons wider or narrower without changing the row's room.
  doc.fonts?.addEventListener("loadingdone", fit);
  return { fit };
}
