/**
 * The canvas map's geometry (shell/Minimap.ts, ADR 0082): the world that the desktop's normal windows
 * and the part in sight span, fitted into the map's box, and the pan that puts the part in sight
 * where the map points. World pixels are the canvas's; map pixels are the box's.
 */
import type { Offset } from "../surface/coordinates";
import type { Rect } from "../surface/geometry";

/** The map's box in CSS pixels, in the 1440×900 frame's proportions. */
export const MAP = { w: 192, h: 120 } as const;
/** Room around what the map shows, as a share of the world's longer side. */
const MARGIN = 0.06;

/** World to map: one scale for both axes, then an offset that centres the world in the box. */
export interface Fit {
  scale: number;
  x: number;
  y: number;
}

/** The part of the canvas in sight at `pan` in a `vw`×`vh` app. */
export function viewRect(pan: Offset, vw: number, vh: number): Rect {
  return { x: 0 - pan.x, y: 0 - pan.y, w: vw, h: vh };
}

/** What the map shows: every window and the part in sight, with a margin round them. */
export function worldOf(windows: readonly Rect[], view: Rect): Rect {
  let x0 = view.x;
  let y0 = view.y;
  let x1 = view.x + view.w;
  let y1 = view.y + view.h;
  for (const r of windows) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  const m = Math.max(x1 - x0, y1 - y0) * MARGIN;
  return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
}

/** Fit `world` into `box` whole, centred on the axis it does not fill. */
export function fitWorld(world: Rect, box: { w: number; h: number } = MAP): Fit {
  const scale = Math.min(box.w / Math.max(1, world.w), box.h / Math.max(1, world.h));
  return {
    scale,
    x: (box.w - world.w * scale) / 2 - world.x * scale,
    y: (box.h - world.h * scale) / 2 - world.y * scale,
  };
}

export function toMap(r: Rect, f: Fit): Rect {
  return { x: r.x * f.scale + f.x, y: r.y * f.scale + f.y, w: r.w * f.scale, h: r.h * f.scale };
}

export function toWorld(x: number, y: number, f: Fit): Offset {
  return { x: (x - f.x) / f.scale, y: (y - f.y) / f.scale };
}

/** The pan that centres the part in sight on the world point `at`. */
export function panCentredOn(at: Offset, vw: number, vh: number): Offset {
  return { x: Math.round(vw / 2 - at.x), y: Math.round(vh / 2 - at.y) };
}

/** Dragging the part in sight by `dx`, `dy` map pixels moves the canvas the other way, scaled up. */
export function panMovedBy(start: Offset, dx: number, dy: number, f: Fit): Offset {
  return { x: Math.round(start.x - dx / f.scale), y: Math.round(start.y - dy / f.scale) };
}

/** An arrow key moves the part in sight a quarter of itself; with Shift, a whole view. */
export function panByKey(
  pan: Offset,
  key: string,
  whole: boolean,
  vw: number,
  vh: number,
): Offset | null {
  const k = whole ? 1 : 0.25;
  const step = { x: Math.round(vw * k), y: Math.round(vh * k) };
  if (key === "ArrowLeft") return { x: pan.x + step.x, y: pan.y };
  if (key === "ArrowRight") return { x: pan.x - step.x, y: pan.y };
  if (key === "ArrowUp") return { x: pan.x, y: pan.y + step.y };
  if (key === "ArrowDown") return { x: pan.x, y: pan.y - step.y };
  return null;
}
