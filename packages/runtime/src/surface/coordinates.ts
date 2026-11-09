import type { SurfacePlacement } from "../modes/types";
import { freeArea, fromScreen, REF, type Rect, SAFE, toScreen } from "./geometry";
import { fillRect, fillTop } from "./snap";

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
 * app, and a filled one takes its part of the free area whatever its size. Its top is the one it
 * was filled with (under Eris's place or under the chips, `freeTop`), never above the bars.
 */
export function screenRect(p: SurfacePlacement, pan: Offset, vw: number, vh: number): Rect {
  if (!isFloating(p)) return { x: p.x + pan.x, y: p.y + pan.y, w: p.w, h: p.h };
  if (!p.fill) return toScreen(p, vw, vh);
  return fillRect(p.fill, freeArea(vw, vh, Math.max(SAFE.top, fillTop(p.fill, p))));
}

export function storedRect(r: Rect, floating: boolean, pan: Offset, vw: number, vh: number): Rect {
  return floating ? fromScreen(r, vw, vh) : { ...r, x: r.x - pan.x, y: r.y - pan.y };
}
