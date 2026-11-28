// The canvas the graph is drawn on: sized to its box at the device's pixel ratio, panned by
// dragging, zoomed by the wheel or a pinch, a node picked by a click (twice: what lies around it),
// hovered nodes lighting their neighbours. Draws only when something changed.

import { draw, hit, palette, viewOf, zoomAt } from "./canvas.js";

/**
 * @typedef {import("./canvas.js").Scene} Scene
 * @typedef {{ scene?: Scene, only?: Set<number>, selected: number, marked: Set<number>, fitKey: number }} Frame
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ pick(id: string | null): void, around(id: string): void }} on
 */
export function createStage(canvas, on) {
  const c = canvas.getContext("2d");
  /** @type {Frame} */
  let frame = { selected: -1, marked: new Set(), fitKey: -1 };
  let view = { x: 0, y: 0, k: 1 };
  let fitted = -1;
  let hover = -1;
  let width = 0;
  let height = 0;
  let ratio = 1;
  /** @type {ReturnType<typeof palette> | undefined} */
  let colors;
  let queued = false;
  /** @type {{ x: number, y: number, vx: number, vy: number, moved: boolean } | undefined} */
  let drag;

  const paint = () => {
    queued = false;
    if (!c || !frame.scene || !width || !height) return;
    // Read once the canvas is in the page: a detached element computes no theme values.
    if (!colors?.background && canvas.isConnected) colors = palette(canvas);
    if (!colors) return;
    draw(c, frame.scene, view, colors, {
      width,
      height,
      ratio,
      hover,
      selected: frame.selected,
      marked: frame.marked,
      only: frame.only,
    });
  };
  const later = () => {
    if (queued) return;
    queued = true;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(paint);
    // A page the desk keeps in the background gets no frames; it still paints, a little later.
    setTimeout(() => queued && paint(), 120);
  };
  const size = () => {
    const box = canvas.getBoundingClientRect();
    ratio = window.devicePixelRatio || 1;
    width = box.width;
    height = box.height;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    if (frame.scene && fitted !== frame.fitKey && width > 0) refit();
    later();
  };
  const refit = () => {
    if (!frame.scene) return;
    view = viewOf(frame.scene, width, height, frame.only);
    fitted = frame.fitKey;
  };
  const at = (/** @type {MouseEvent} */ event) => {
    const box = canvas.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  };
  const pickAt = (/** @type {MouseEvent} */ event) => {
    if (!frame.scene) return -1;
    const [x, y] = at(event);
    return hit(frame.scene, view, x, y, frame.only);
  };

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, moved: false };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (drag) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) {
        view = { ...view, x: drag.vx + dx, y: drag.vy + dy };
        later();
      }
      return;
    }
    const found = pickAt(event);
    if (found !== hover) {
      hover = found;
      canvas.style.cursor = found >= 0 ? "pointer" : "";
      later();
    }
  });
  canvas.addEventListener("pointerup", (event) => {
    const moved = drag?.moved;
    drag = undefined;
    if (moved || !frame.scene) return;
    const found = pickAt(event);
    on.pick(found >= 0 ? frame.scene.ids[found] : null);
  });
  canvas.addEventListener("pointerleave", () => {
    if (hover >= 0) {
      hover = -1;
      later();
    }
  });
  canvas.addEventListener("dblclick", (event) => {
    const found = pickAt(event);
    if (found >= 0 && frame.scene) on.around(frame.scene.ids[found]);
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const [x, y] = at(event);
      view = zoomAt(view, x, y, Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)));
      later();
    },
    { passive: false },
  );
  // Measured on every frame shown too: a resize observer's first report can come late.
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(size) : undefined;
  observer?.observe(canvas);

  return {
    /** Draw a new frame; a new fitKey fits the view to what is drawn. */
    show(/** @type {Frame} */ next) {
      const scene = next.scene;
      if (scene !== frame.scene) hover = -1;
      frame = next;
      const box = canvas.getBoundingClientRect();
      if (box.width !== width || box.height !== height) size();
      if (scene && next.fitKey !== fitted && width > 0) refit();
      later();
    },
    /** Read the theme's colours again (the theme changed). */
    retheme() {
      colors = undefined;
      later();
    },
    resize: size,
  };
}
