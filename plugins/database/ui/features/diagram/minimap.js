import { t } from "../../strings/index.js";

// The diagram's map (PG-55): from MAP_FROM tables, the whole diagram small in a corner, every box
// one shape of a single path and the view a frame over it; a press or a drag on it puts that spot
// at the stage's centre. Hidden for a small diagram.

/**
 * @typedef {import("./layout.js").Layout} Layout
 * @typedef {import("./stage.js").View} View
 */

const SVG = "http://www.w3.org/2000/svg";
export const MAP_FROM = 30;

/**
 * @param {Document} doc
 * @param {HTMLElement} host
 * @param {(x: number, y: number) => void} jump Puts a scene point at the stage's centre.
 */
export function createMap(doc, host, jump) {
  const map = doc.createElementNS(SVG, "svg");
  map.setAttribute("class", "er-map");
  map.setAttribute("role", "img");
  map.setAttribute("aria-label", t("features.diagram.minimap.mapOfTheDiagramPressTo"));
  map.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const boxes = doc.createElementNS(SVG, "path");
  boxes.setAttribute("class", "er-map-boxes");
  const frame = doc.createElementNS(SVG, "rect");
  frame.setAttribute("class", "er-map-view");
  map.append(boxes, frame);
  host.append(map);
  let bounds = { x: 0, y: 0, w: 1, h: 1 };

  /** A press on the map as a scene point. */
  const pointOf = (/** @type {PointerEvent} */ event) => {
    const r = map.getBoundingClientRect();
    const scale = Math.min(r.width / bounds.w, r.height / bounds.h) || 1;
    const ox = (r.width - bounds.w * scale) / 2;
    const oy = (r.height - bounds.h * scale) / 2;
    return {
      x: bounds.x + (event.clientX - r.left - ox) / scale,
      y: bounds.y + (event.clientY - r.top - oy) / scale,
    };
  };
  let pressed = false;
  const down = (/** @type {PointerEvent} */ event) => {
    pressed = true;
    map.setPointerCapture?.(event.pointerId);
    const p = pointOf(event);
    jump(p.x, p.y);
    event.stopPropagation();
  };
  const over = (/** @type {PointerEvent} */ event) => {
    if (!pressed) return;
    const p = pointOf(event);
    jump(p.x, p.y);
  };
  const up = () => {
    pressed = false;
  };
  map.addEventListener("pointerdown", down);
  map.addEventListener("pointermove", over);
  map.addEventListener("pointerup", up);
  map.addEventListener("pointercancel", up);

  return {
    el: map,
    /** Draw a layout's boxes; the map hides for a small diagram. */
    draw(/** @type {Layout} */ layout) {
      const show = layout.boxes.length >= MAP_FROM;
      map.toggleAttribute("hidden", !show);
      if (!show) return;
      const pad = 40;
      bounds = {
        x: layout.bounds.x - pad,
        y: layout.bounds.y - pad,
        w: layout.bounds.w + 2 * pad,
        h: layout.bounds.h + 2 * pad,
      };
      map.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`);
      boxes.setAttribute(
        "d",
        layout.boxes.map((b) => `M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}z`).join(""),
      );
    },
    /** Frame the part of the scene the stage shows. */
    show(/** @type {View} */ view, /** @type {{ w: number, h: number }} */ size) {
      if (map.hasAttribute("hidden")) return;
      frame.setAttribute("x", String(-view.x / view.k));
      frame.setAttribute("y", String(-view.y / view.k));
      frame.setAttribute("width", String(size.w / view.k));
      frame.setAttribute("height", String(size.h / view.k));
    },
    destroy() {
      map.removeEventListener("pointerdown", down);
      map.removeEventListener("pointermove", over);
      map.removeEventListener("pointerup", up);
      map.removeEventListener("pointercancel", up);
    },
  };
}
