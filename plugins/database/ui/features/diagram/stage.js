// The diagram's stage (PG-55): one SVG whose scene (svg.js's markup) is moved and scaled as a whole
// to pan and zoom; the wheel pans (with Mod it zooms at the pointer), a drag on the background pans,
// a drag on a table moves it and the lines to it follow, Fit shows everything. For a large diagram
// only the boxes and lines near the view are displayed, and far out the column rows are not drawn.
// Every redraw of the view waits for the next frame. Keys are panel.js's.

import { moveBoxes } from "./layout.js";
import { lineMarkup, sceneOf } from "./svg.js";

/**
 * @typedef {import("./layout.js").Layout} Layout
 * @typedef {{ k: number, x: number, y: number }} View screen = scene × k + (x, y)
 * @typedef {{
 *   moved(moves: [string, number, number][]): void,
 *   viewed?(view: View, size: { w: number, h: number }): void,
 * }} Hooks
 */

const SVG = "http://www.w3.org/2000/svg";
export const FAR = 0.45;
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 3;
const SNAP = 4;
const MARGIN = 32;

/** @param {Document} doc @param {HTMLElement} host @param {Hooks} hooks */
export function createStage(doc, host, hooks) {
  const win = /** @type {Window} */ (doc.defaultView);
  const frame = (/** @type {() => void} */ fn) =>
    win.requestAnimationFrame ? win.requestAnimationFrame(fn) : win.setTimeout(fn, 16);
  const svg = /** @type {SVGSVGElement} */ (doc.createElementNS(SVG, "svg"));
  svg.setAttribute("class", "er");
  svg.setAttribute("role", "group");
  const scene = doc.createElementNS(SVG, "g");
  scene.setAttribute("class", "er-scene");
  svg.append(scene);
  host.append(svg);

  /** @type {Layout} */
  let layout = { boxes: [], lines: [], bounds: { x: 0, y: 0, w: 0, h: 0 }, mode: "all" };
  /** @type {View} */
  let view = { k: 1, x: 0, y: 0 };
  /** @type {Element[]} */
  let tables = [];
  /** @type {Element[]} */
  let lines = [];
  /** @type {boolean[]} */
  let boxShown = [];
  /** @type {boolean[]} */
  let lineShown = [];
  let queued = false;

  const size = () => ({ w: svg.clientWidth || 800, h: svg.clientHeight || 500 });
  const lineBox = (/** @type {number} */ i) => {
    const p = layout.lines[i]?.points ?? [];
    const xs = p.map((q) => q[0]);
    const ys = p.map((q) => q[1]);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  };

  /** Show only what lies near the view; far out, no column rows. */
  const cull = () => {
    const { w, h } = size();
    const pad = 160 / view.k;
    const left = -view.x / view.k - pad;
    const top = -view.y / view.k - pad;
    const right = left + w / view.k + 2 * pad;
    const bottom = top + h / view.k + 2 * pad;
    const near = (/** @type {{ x: number, y: number, w: number, h: number }} */ r) =>
      r.x + r.w >= left && r.x <= right && r.y + r.h >= top && r.y <= bottom;
    layout.boxes.forEach((b, i) => {
      const show = near(b);
      if (show !== boxShown[i]) {
        boxShown[i] = show;
        if (show) tables[i]?.removeAttribute("display");
        else tables[i]?.setAttribute("display", "none");
      }
    });
    layout.lines.forEach((_, i) => {
      const show = near(lineBox(i));
      if (show !== lineShown[i]) {
        lineShown[i] = show;
        if (show) lines[i]?.removeAttribute("display");
        else lines[i]?.setAttribute("display", "none");
      }
    });
    svg.classList.toggle("er-far", view.k < FAR);
  };

  const apply = () => {
    queued = false;
    scene.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);
    cull();
    hooks.viewed?.(view, size());
  };
  const later = () => {
    if (queued) return;
    queued = true;
    frame(apply);
  };

  /** Zoom by a factor about a point of the stage (its centre by default). */
  const zoom = (/** @type {number} */ by, at = { x: size().w / 2, y: size().h / 2 }) => {
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * by));
    view = {
      k,
      x: at.x - ((at.x - view.x) * k) / view.k,
      y: at.y - ((at.y - view.y) * k) / view.k,
    };
    later();
  };
  const fitAll = () => {
    const { w, h } = size();
    const b = layout.bounds;
    if (b.w <= 0 || b.h <= 0) {
      view = { k: 1, x: MARGIN, y: MARGIN };
    } else {
      const k = Math.min(
        1,
        Math.max(MIN_ZOOM, Math.min((w - 2 * MARGIN) / b.w, (h - 2 * MARGIN) / b.h)),
      );
      view = { k, x: (w - b.w * k) / 2 - b.x * k, y: (h - b.h * k) / 2 - b.y * k };
    }
    later();
  };
  const panBy = (/** @type {number} */ dx, /** @type {number} */ dy) => {
    view = { ...view, x: view.x + dx, y: view.y + dy };
    later();
  };
  /** Put a scene point at the stage's centre. */
  const center = (/** @type {number} */ x, /** @type {number} */ y) => {
    const { w, h } = size();
    view = { ...view, x: w / 2 - x * view.k, y: h / 2 - y * view.k };
    later();
  };

  /** Draw a box's lines again after it moved. */
  const redrawLines = (/** @type {Set<number>} */ touched) => {
    for (const i of touched) {
      const line = layout.lines[i];
      const old = lines[i];
      if (!line || !old) continue;
      const holder = doc.createElementNS(SVG, "g");
      holder.innerHTML = lineMarkup(line, i);
      const fresh = /** @type {Element} */ (holder.firstElementChild);
      old.replaceWith(fresh);
      lines[i] = fresh;
      lineShown[i] = true;
    }
  };

  /** Move boxes (index to scene position): on screen at once, the lines to them routed again. */
  const move = (/** @type {Map<number, [number, number]>} */ moves) => {
    const touched = moveBoxes(layout, moves);
    for (const i of moves.keys()) {
      const b = layout.boxes[i];
      tables[i]?.setAttribute("transform", `translate(${b?.x},${b?.y})`);
    }
    redrawLines(touched);
    later();
  };

  // A drag: on a table it moves the table, on the background it pans.
  /** @type {{ id: number, table: number, sx: number, sy: number, bx: number, by: number, vx: number, vy: number, moved: boolean } | null} */
  let drag = null;
  /** @type {{ x: number, y: number } | null} */
  let pending = null;
  const step = () => {
    if (!drag || !pending) return;
    const { x, y } = pending;
    pending = null;
    if (drag.table < 0) {
      view = { ...view, x: drag.vx + x - drag.sx, y: drag.vy + y - drag.sy };
      later();
      return;
    }
    const nx = Math.round((drag.bx + (x - drag.sx) / view.k) / SNAP) * SNAP;
    const ny = Math.round((drag.by + (y - drag.sy) / view.k) / SNAP) * SNAP;
    const box = layout.boxes[drag.table];
    if (box && (box.x !== nx || box.y !== ny)) {
      drag.moved = true;
      move(new Map([[drag.table, [nx, ny]]]));
    }
  };
  const down = (/** @type {PointerEvent} */ event) => {
    if (event.button !== 0) return;
    const el = /** @type {Element} */ (event.target).closest?.("g.er-table");
    const table = el ? Number(el.getAttribute("data-b")) : -1;
    const box = layout.boxes[table];
    drag = {
      id: event.pointerId,
      table: box ? table : -1,
      sx: event.clientX,
      sy: event.clientY,
      bx: box?.x ?? 0,
      by: box?.y ?? 0,
      vx: view.x,
      vy: view.y,
      moved: false,
    };
    svg.setPointerCapture?.(event.pointerId);
    if (box) /** @type {SVGGElement} */ (el)?.focus?.();
    svg.classList.add(box ? "er-moving" : "er-panning");
  };
  const over = (/** @type {PointerEvent} */ event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const first = pending === null;
    pending = { x: event.clientX, y: event.clientY };
    if (first) frame(step);
  };
  const up = (/** @type {PointerEvent} */ event) => {
    if (!drag || event.pointerId !== drag.id) return;
    pending = { x: event.clientX, y: event.clientY };
    step();
    const done = drag;
    drag = null;
    svg.classList.remove("er-moving", "er-panning");
    const box = layout.boxes[done.table];
    if (done.moved && box) hooks.moved([[box.id, box.x, box.y]]);
  };
  const wheel = (/** @type {WheelEvent} */ event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const r = svg.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * 0.002), {
        x: event.clientX - r.left,
        y: event.clientY - r.top,
      });
    } else panBy(-event.deltaX, -event.deltaY);
  };
  svg.addEventListener("pointerdown", down);
  svg.addEventListener("pointermove", over);
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointercancel", up);
  svg.addEventListener("wheel", wheel, { passive: false });

  return {
    svg,
    /** Draw a layout, keeping the view (Fit when `fitted`). */
    draw(/** @type {Layout} */ next, fitted = false) {
      layout = next;
      scene.innerHTML = sceneOf(layout);
      tables = [...scene.querySelectorAll("g.er-table")];
      lines = [...scene.querySelectorAll("g.er-link")];
      boxShown = tables.map(() => true);
      lineShown = lines.map(() => true);
      svg.setAttribute(
        "aria-label",
        `${layout.boxes.length} tables, ${layout.lines.length} relations`,
      );
      // The first frame has the stage's size: fit again then.
      if (fitted) {
        fitAll();
        frame(fitAll);
      } else later();
    },
    fitAll,
    zoom,
    panBy,
    center,
    move,
    /** The element of a box, by index. */
    table: (/** @type {number} */ i) => /** @type {SVGGElement | undefined} */ (tables[i]),
    view: () => view,
    size,
    layout: () => layout,
    /** Redraw the view now (tests; a frame that does not animate). */
    flush: apply,
    destroy() {
      svg.removeEventListener("pointerdown", down);
      svg.removeEventListener("pointermove", over);
      svg.removeEventListener("pointerup", up);
      svg.removeEventListener("pointercancel", up);
      svg.removeEventListener("wheel", wheel);
    },
  };
}
