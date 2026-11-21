// The grid's header under the pointer: a header dragged sideways past a few pixels moves its column
// to where it is let go (a marker shows the place), a header's grip at its right edge resizes the
// column as it is dragged, and a double click on the grip fits the column to its content. A drag
// never sorts: the click its release sends is swallowed. Keys do the same (view-grid.js).

import { el } from "../dom.js";

const THRESHOLD = 4;

/**
 * @typedef {{
 *   width(col: number): number,
 *   resize(col: number, px: number, done: boolean): void,
 *   fit(col: number): void,
 *   drop(col: number, index: number): void,
 * }} HeaderActs
 *   `col` and `index` are screen columns, as the headers' data-col says.
 */

/**
 * @param {Document} doc
 * @param {HTMLElement} head The header row.
 * @param {HTMLElement} grid Where the drop marker is drawn (positioned).
 * @param {HeaderActs} acts
 */
export function attachHeader(doc, head, grid, acts) {
  const win = doc.defaultView;
  const marker = el(doc, "div", { class: "drop-marker", "aria-hidden": "true", hidden: "" });
  const colOf = (/** @type {Element | null} */ cell) =>
    Number(/** @type {HTMLElement | null} */ (cell)?.dataset.col ?? Number.NaN);
  const cells = () =>
    /** @type {HTMLElement[]} */ ([...head.querySelectorAll("[role=columnheader]")]);

  /** The screen column a pointer at `x` would put a column before, by the headers' middles. */
  const placeAt = (/** @type {number} */ x) => {
    const all = cells();
    for (const cell of all) {
      const box = cell.getBoundingClientRect();
      if (x < box.left + box.width / 2) return { index: colOf(cell), edge: box.left };
    }
    const last = all.at(-1);
    return { index: last ? colOf(last) + 1 : 0, edge: last?.getBoundingClientRect().right ?? 0 };
  };

  /** The click a drag's release sends must not sort. */
  const swallow = () => {
    const stop = (/** @type {Event} */ event) => {
      event.stopPropagation();
      event.preventDefault();
    };
    win?.addEventListener("click", stop, { capture: true, once: true });
    setTimeout(() => win?.removeEventListener("click", stop, { capture: true }), 0);
  };

  /** Follow the pointer until it is let go. */
  const follow = (
    /** @type {PointerEvent} */ down,
    /** @type {(e: PointerEvent) => void} */ moved,
    /** @type {(e: PointerEvent) => void} */ ended,
  ) => {
    const move = (/** @type {Event} */ e) => moved(/** @type {PointerEvent} */ (e));
    const up = (/** @type {Event} */ e) => {
      win?.removeEventListener("pointermove", move, true);
      win?.removeEventListener("pointerup", up, true);
      win?.removeEventListener("pointercancel", up, true);
      ended(/** @type {PointerEvent} */ (e));
    };
    win?.addEventListener("pointermove", move, true);
    win?.addEventListener("pointerup", up, true);
    win?.addEventListener("pointercancel", up, true);
    down.preventDefault();
  };

  head.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const target = /** @type {HTMLElement} */ (event.target);
    const cell = target.closest("[role=columnheader]");
    const col = colOf(cell);
    if (!cell || Number.isNaN(col)) return;
    const x0 = event.clientX;
    if (target.closest(".grip")) {
      const start = acts.width(col);
      let px = start;
      follow(
        event,
        (e) => {
          px = start + e.clientX - x0;
          acts.resize(col, px, false);
        },
        () => {
          // A press without a move is half of a double click: nothing redraws between the two.
          if (px === start) return;
          acts.resize(col, px, true);
          swallow();
        },
      );
      return;
    }
    let dragging = false;
    follow(
      event,
      (e) => {
        if (!dragging && Math.abs(e.clientX - x0) < THRESHOLD) return;
        dragging = true;
        cell.classList.add("dragging");
        const origin = grid.getBoundingClientRect();
        marker.style.left = `${placeAt(e.clientX).edge - origin.left}px`;
        marker.hidden = false;
        if (!marker.isConnected) grid.append(marker);
      },
      (e) => {
        marker.hidden = true;
        cell.classList.remove("dragging");
        if (!dragging) return;
        swallow();
        const { index } = placeAt(e.clientX);
        acts.drop(col, index > col ? index - 1 : index);
      },
    );
  });
  // The second click of a double click on a grip fits its column.
  head.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (!target.closest(".grip") || event.detail !== 2) return;
    event.preventDefault();
    acts.fit(colOf(target.closest("[role=columnheader]")));
  });
}
