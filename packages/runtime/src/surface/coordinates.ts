import type { SurfacePlacement } from "../modes/types";
import { fromScreen, REF, type Rect, screenArea, toScreen } from "./geometry";
import { fillRect } from "./snap";

export interface Offset {
  x: number;
  y: number;
}
export const ORIGIN: Offset = { x: 0, y: 0 };
/** Normal windows (the default) sit on the desktop's canvas; floating ones are pinned to the app. */
export const isFloating = (p: SurfacePlacement) => p.floating === true;

export function appSize() {
  const root = typeof document === "undefined" ? null : document.querySelector(".shell");
  return {
    vw: root?.clientWidth || (typeof window === "undefined" ? REF.width : window.innerWidth),
    vh: root?.clientHeight || (typeof window === "undefined" ? REF.height : window.innerHeight),
  };
}

/**
 * Normal placements keep world coordinates and size, moved by the pan; floating ones scale with the
 * app, and a filled one takes its part of the whole app whatever its size (ADR 0132), a fill kept
 * from when fills stayed between the bars too.
 */
export function screenRect(p: SurfacePlacement, pan: Offset, vw: number, vh: number): Rect {
  if (!isFloating(p)) return { x: p.x + pan.x, y: p.y + pan.y, w: p.w, h: p.h };
  if (!p.fill) return toScreen(p, vw, vh);
  return fillRect(p.fill, screenArea(vw, vh));
}

export function storedRect(r: Rect, floating: boolean, pan: Offset, vw: number, vh: number): Rect {
  return floating ? fromScreen(r, vw, vh) : { ...r, x: r.x - pan.x, y: r.y - pan.y };
}
