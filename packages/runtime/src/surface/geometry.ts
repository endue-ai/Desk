/**
 * Surfaces are stored in the 1440×900 reference frame and mapped onto the window between the bars.
 * Smaller windows move them inwards and shrink them; they never shrink below the minimum size.
 */
import type { SurfacePlacement } from "../modes/types";

export const REF = { width: 1440, height: 900 };
/** Room kept free for the bars: left bar and rail (24 + 56 + 24), top chips, bottom line. */
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
 * The free area between the bars and under Eris's place in the reference frame: where windows
 * tile, snap and fill. A window can still be dragged above it, up to the chips.
 */
export const FREE: Rect = {
  x: SAFE.left,
  y: BELOW_ERIS,
  w: REF.width - SAFE.left - SAFE.right,
  h: REF.height - BELOW_ERIS - SAFE.bottom,
};

/** The free area as it sits on a window of `vw`×`vh` pixels. */
export function freeOnScreen(vw: number, vh: number): Rect {
  return {
    x: SAFE.left,
    y: BELOW_ERIS,
    w: Math.max(MIN.w, vw - SAFE.left - SAFE.right),
    h: Math.max(MIN.h, vh - BELOW_ERIS - SAFE.bottom),
  };
}

function factors(vw: number, vh: number) {
  const kx = (vw - SAFE.left - SAFE.right) / (REF.width - SAFE.left - SAFE.right);
  const ky = (vh - SAFE.top - SAFE.bottom) / (REF.height - SAFE.top - SAFE.bottom);
  return { kx, ky, k: Math.min(1, kx, ky) };
}

export function toScreen(p: Rect, vw: number, vh: number): Rect {
  const { kx, ky, k } = factors(vw, vh);
  const w = Math.max(MIN.w, Math.round(p.w * k));
  const h = Math.max(MIN.h, Math.round(p.h * k));
  const x = Math.round(SAFE.left + (p.x - SAFE.left) * kx);
  const y = Math.round(SAFE.top + (p.y - SAFE.top) * ky);
  return {
    x: Math.max(SAFE.left, Math.min(x, vw - SAFE.right - w)),
    y: Math.max(SAFE.top, Math.min(y, vh - SAFE.bottom - h)),
    w,
    h,
  };
}

/** The inverse, for a surface the user dragged or resized on screen. */
export function fromScreen(
  r: Rect,
  vw: number,
  vh: number,
): Pick<SurfacePlacement, "x" | "y" | "w" | "h"> {
  const { kx, ky, k } = factors(vw, vh);
  return {
    x: Math.round(SAFE.left + (r.x - SAFE.left) / kx),
    y: Math.round(SAFE.top + (r.y - SAFE.top) / ky),
    w: Math.round(r.w / k),
    h: Math.round(r.h / k),
  };
}

/** Keep a dragged rect inside the free area of the window. */
export function clampRect(r: Rect, vw: number, vh: number): Rect {
  const w = Math.max(MIN.w, Math.min(r.w, vw - SAFE.left - SAFE.right));
  const h = Math.max(MIN.h, Math.min(r.h, vh - SAFE.top - SAFE.bottom));
  return {
    x: Math.max(SAFE.left, Math.min(r.x, vw - SAFE.right - w)),
    y: Math.max(SAFE.top, Math.min(r.y, vh - SAFE.bottom - h)),
    w,
    h,
  };
}
