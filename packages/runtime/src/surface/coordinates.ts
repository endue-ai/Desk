import type { SurfacePlacement } from "../modes/types";
import { fromScreen, REF, type Rect, toScreen } from "./geometry";

export interface Offset {
  x: number;
  y: number;
}
export const ORIGIN: Offset = { x: 0, y: 0 };
export const isFloating = (p: SurfacePlacement) => p.floating !== false;

export function appSize() {
  const root = typeof document === "undefined" ? null : document.querySelector(".shell");
  return {
    vw: root?.clientWidth || (typeof window === "undefined" ? REF.width : window.innerWidth),
    vh: root?.clientHeight || (typeof window === "undefined" ? REF.height : window.innerHeight),
  };
}

/** Floating placements scale with the app; canvas placements retain world coordinates and size. */
export function screenRect(p: SurfacePlacement, pan: Offset, vw: number, vh: number): Rect {
  return isFloating(p) ? toScreen(p, vw, vh) : { x: p.x + pan.x, y: p.y + pan.y, w: p.w, h: p.h };
}

export function storedRect(r: Rect, floating: boolean, pan: Offset, vw: number, vh: number): Rect {
  return floating ? fromScreen(r, vw, vh) : { ...r, x: r.x - pan.x, y: r.y - pan.y };
}
