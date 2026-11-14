/**
 * Where a window's section lies and how big it is. In the desk's page it lies at its window's place
 * in the desk's state. In its window's own page (ADR 0201) it fills that page from its top left:
 * laid out for the size the page has, never for the place, which runs ahead of the page's size
 * while the window is resized (desk-wm's place, then the compositor's plan, then the page's resize,
 * then its paint). Sized from the place, the section was cut at the page's edge (a title bar's ✕
 * during a corner drag) or left the page's background past it until the page caught up (#270).
 */
import type { Rect } from "../wm/types";

/** Lay `el` out for its window at `rect`: in its own page (`own`) filling it, else at `rect`. */
export function placeSection(el: HTMLElement, rect: Rect, own: boolean): void {
  const [left, top, width, height] = own
    ? ["0px", "0px", "100vw", "100vh"]
    : [`${rect.x}px`, `${rect.y}px`, `${rect.w}px`, `${rect.h}px`];
  // Only what changed is written: in its own page a window's every move and resize writes nothing.
  for (const [name, value] of [
    ["left", left],
    ["top", top],
    ["width", width],
    ["height", height],
  ] as const) {
    if (el.style[name] !== value) el.style[name] = value;
  }
}
