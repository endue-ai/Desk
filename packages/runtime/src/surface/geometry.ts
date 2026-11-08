/**
 * Surfaces are stored in the 1440×900 reference frame and mapped onto the app's window. Smaller
 * windows move them inwards and shrink them, each axis on its own: a shorter app takes height, a
 * narrower one width. They never shrink below the minimum size, and a surface may be dragged to
 * every edge of the window: the bars float above it. A fill stays in the free area (`freeArea`).
 */
import type { SurfacePlacement } from "../modes/types";

export const REF = { width: 1440, height: 900 };
/**
 * Where the bars sit, the one record of it: the side bars and the rail 24 + 56 + 24 from each side,
 * the profile switcher and the desktops 72 from the top, the drawer button, the composer and the
 * running chips 88 from the bottom. Windows open, tile and fill inside it.
 */
export const SAFE = { left: 104, right: 104, top: 72, bottom: 88 };
export const MIN = { w: 240, h: 160 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where Eris sits by default (centred, 40 px from the top, 138 px tall): windows tile below her. */
export const BELOW_ERIS = 190;

/**
 * The free area between the bars and under Eris's place in the reference frame: where plugin
 * windows open. A window can still be dragged or resized over the bars, which stay on top.
 */
export const FREE: Rect = freeArea(REF.width, REF.height, BELOW_ERIS);

/** The whole app window of `vw`×`vh` pixels: how far a window can move and grow. */
export function screenArea(vw: number, vh: number): Rect {
  return { x: 0, y: 0, w: vw, h: vh };
}

/**
 * Where the free area starts: under Eris while she sits in her default place, where she floats
 * above every window as the bars do, and under the profile switcher and the desktops once she is
 * moved.
 */
export function freeTop(erisAtHome: boolean): number {
  return erisAtHome ? BELOW_ERIS : SAFE.top;
}

/**
 * The part of a `vw`×`vh` app no bar covers, from `top` down: what a maximized or snapped window
 * fills, so no bar lies over its contents, and what arranging tiles (ADR 0040's free area).
 */
export function freeArea(vw: number, vh: number, top: number = SAFE.top): Rect {
  return {
    x: SAFE.left,
    y: top,
    w: Math.max(MIN.w, vw - SAFE.left - SAFE.right),
    h: Math.max(MIN.h, vh - top - SAFE.bottom),
  };
}

/** Positions follow the app both ways; sizes only shrink, width with the width, height with the height. */
function factors(vw: number, vh: number) {
  const kx = (vw - SAFE.left - SAFE.right) / (REF.width - SAFE.left - SAFE.right);
  const ky = (vh - SAFE.top - SAFE.bottom) / (REF.height - SAFE.top - SAFE.bottom);
  return { kx, ky, sx: Math.min(1, kx), sy: Math.min(1, ky) };
}

export function toScreen(p: Rect, vw: number, vh: number): Rect {
  const { kx, ky, sx, sy } = factors(vw, vh);
  const w = Math.max(MIN.w, Math.round(p.w * sx));
  const h = Math.max(MIN.h, Math.round(p.h * sy));
  const x = Math.round(SAFE.left + (p.x - SAFE.left) * kx);
  const y = Math.round(SAFE.top + (p.y - SAFE.top) * ky);
  return clampRect({ x, y, w, h }, vw, vh);
}

/** The inverse, for a surface the user dragged or resized on screen. */
export function fromScreen(
  r: Rect,
  vw: number,
  vh: number,
): Pick<SurfacePlacement, "x" | "y" | "w" | "h"> {
  const { kx, ky, sx, sy } = factors(vw, vh);
  return {
    x: Math.round(SAFE.left + (r.x - SAFE.left) / kx),
    y: Math.round(SAFE.top + (r.y - SAFE.top) / ky),
    w: Math.round(r.w / sx),
    h: Math.round(r.h / sy),
  };
}

/** Keep a dragged rect inside the app window: as large as it, never off it. */
export function clampRect(r: Rect, vw: number, vh: number): Rect {
  const w = Math.max(MIN.w, Math.min(r.w, vw));
  const h = Math.max(MIN.h, Math.min(r.h, vh));
  return {
    x: Math.max(0, Math.min(r.x, vw - w)),
    y: Math.max(0, Math.min(r.y, vh - h)),
    w,
    h,
  };
}
