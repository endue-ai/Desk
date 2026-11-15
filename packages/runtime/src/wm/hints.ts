/**
 * What a plugin's manifest asks of its window (`SurfaceWindow` in specs/plugin v0, ADR 0226), as
 * the window manager reads it (`WindowHints` in crates/desk-wm): the page's first size, its
 * smallest, and whether the person can resize the window. `opens` is the shell's to read: only a
 * desk with a compositor has OS windows.
 */
import type { SurfaceWindow } from "@endue-ai/bridge";
import type { WindowHints } from "./types";

/** The hints of a manifest's `window` block; undefined when it asks nothing of the canvas. */
export function windowHints(window: SurfaceWindow | undefined): WindowHints | undefined {
  if (!window) return undefined;
  const { size, minSize, resizable } = window;
  const hints: WindowHints = {
    ...(size && { size: { w: size.width, h: size.height } }),
    ...(minSize && { min: { w: minSize.width, h: minSize.height } }),
    ...(resizable === false && { fixed: true }),
  };
  return Object.keys(hints).length > 0 ? hints : undefined;
}
