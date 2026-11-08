// The grid's keys, all of them ones the desk keymap leaves free: arrows (Mod for the edge of the
// data, Shift to extend), Page Up and Page Down, Home and End (Mod for the sheet's first and last
// cell), Enter to go down and Escape to drop a range. Any other key is left alone.

/** @typedef {ReturnType<typeof import("./selection.js").createSelection>} Selection */

const ARROWS = /** @type {Record<string, [number, number]>} */ ({
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
});

/**
 * Apply a key press to the selection.
 * @param {KeyboardEvent} event
 * @param {Selection} selection
 * @param {number} page rows in one page
 * @returns {{ extend: boolean } | undefined} undefined when the key is not the grid's
 */
export function keyMove(event, selection, page) {
  if (event.altKey) return undefined;
  const mod = event.metaKey || event.ctrlKey;
  const extend = event.shiftKey;
  const arrow = ARROWS[event.key];
  if (arrow) {
    if (mod) selection.edge(arrow[0], arrow[1], extend);
    else selection.move(arrow[0], arrow[1], extend);
    return { extend };
  }
  if (mod) {
    if (event.key === "Home") selection.home(true, extend);
    else if (event.key === "End") selection.last(true, extend);
    else return undefined;
    return { extend };
  }
  switch (event.key) {
    case "PageDown":
    case "PageUp":
      selection.move(event.key === "PageDown" ? page : -page, 0, extend);
      return { extend };
    case "Home":
      selection.home(false, extend);
      return { extend };
    case "End":
      selection.last(false, extend);
      return { extend };
    case "Enter":
      selection.move(extend ? -1 : 1, 0, false);
      return { extend: false };
    case "Escape": {
      const { s, e } = selection.range();
      if (s.r === e.r && s.c === e.c) return undefined;
      const active = selection.active();
      selection.set(active.r, active.c);
      return { extend: false };
    }
    default:
      return undefined;
  }
}
