/**
 * The app's size, and a window's mode: normal windows (the default) sit on the desktop's canvas and
 * move with its pan; floating ones are pinned to the app. Where each is on screen is the window
 * manager's to say (crates/desk-wm `screen_rect`, published as `WmView.rects`, #83).
 */
import type { SurfacePlacement } from "../modes/types";
import { REF } from "./geometry";

export interface Offset {
  x: number;
  y: number;
}
export const ORIGIN: Offset = { x: 0, y: 0 };
export const isFloating = (p: Pick<SurfacePlacement, "floating">) => p.floating === true;

export function appSize() {
  const root = typeof document === "undefined" ? null : document.querySelector(".shell");
  return {
    vw: root?.clientWidth || (typeof window === "undefined" ? REF.width : window.innerWidth),
    vh: root?.clientHeight || (typeof window === "undefined" ? REF.height : window.innerHeight),
  };
}
