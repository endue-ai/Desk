// What the map's canvas does with the pointer and the keys (PG-46): a drag pans, a click picks the
// shape under it, a double click shows it in the grid, the wheel zooms about the pointer; the
// arrows pan an eighth of the view, + and − zoom, 0 fits, N and P pick the next and previous row,
// Enter shows the picked row in the grid and Escape lets it go. Focus puts the map's keys on the
// hint line. Mod chords are left to the desk.

import { t } from "../strings/index.js";
import { pan } from "./plane.js";

/**
 * @typedef {import("./plane.js").View} View
 * @typedef {{
 *   view(): View | null, size(): { width: number, height: number }, setView(view: View): void,
 *   zoomBy(factor: number, x?: number, y?: number): void, refit(): void, pickAt(x: number, y: number): Promise<void>,
 *   step(delta: number): void, showInGrid(): void, unpick(): boolean, hover(x: number, y: number): void,
 * }} Handlers
 */

export const HINTS = t("geo.mapInput.dragOrArrowsPanWheelAnd");
const CLICK = 3;

/** @param {HTMLCanvasElement} canvas @param {Handlers} on */
export function wireInput(canvas, on) {
  /** @type {{ x: number, y: number, view: View, moved: number } | null} */
  let drag = null;
  canvas.addEventListener("pointerdown", (event) => {
    const view = on.view();
    if (!view || event.button !== 0) return;
    drag = { x: event.offsetX, y: event.offsetY, view, moved: 0 };
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return on.hover(event.offsetX, event.offsetY);
    const dx = event.offsetX - drag.x;
    const dy = event.offsetY - drag.y;
    drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
    if (drag.moved >= CLICK) on.setView(pan(drag.view, dx, dy));
  });
  canvas.addEventListener("pointerup", (event) => {
    const was = drag;
    drag = null;
    if (was && was.moved < CLICK) void on.pickAt(event.offsetX, event.offsetY);
  });
  canvas.addEventListener("pointercancel", () => {
    drag = null;
  });
  canvas.addEventListener("dblclick", (event) => {
    void on.pickAt(event.offsetX, event.offsetY).then(() => on.showInGrid());
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const lines = event.deltaMode === 1 ? 16 : 1;
      on.zoomBy(Math.exp(-event.deltaY * lines * 0.002), event.offsetX, event.offsetY);
    },
    { passive: false },
  );
  canvas.addEventListener("focusin", (event) => {
    // The results' box would put the grid's keys there.
    event.stopPropagation();
    const hints = canvas.ownerDocument.getElementById("hints");
    if (hints) hints.textContent = HINTS;
  });
  canvas.addEventListener("keydown", (event) => {
    const view = on.view();
    if (!view || event.metaKey || event.ctrlKey || event.altKey) return;
    const { width, height } = on.size();
    const moves = /** @type {Record<string, [number, number]>} */ ({
      ArrowLeft: [width / 8, 0],
      ArrowRight: [-width / 8, 0],
      ArrowUp: [0, height / 8],
      ArrowDown: [0, -height / 8],
    });
    const move = moves[event.key];
    if (move) on.setView(pan(view, move[0], move[1]));
    else if (event.key === "+" || event.key === "=") on.zoomBy(2);
    else if (event.key === "-" || event.key === "_") on.zoomBy(0.5);
    else if (event.key === "0") on.refit();
    else if (event.key === "n" || event.key === "N") on.step(1);
    else if (event.key === "p" || event.key === "P") on.step(-1);
    else if (event.key === "Enter") on.showInGrid();
    else if (event.key !== "Escape" || !on.unpick()) return;
    event.preventDefault();
  });
}
