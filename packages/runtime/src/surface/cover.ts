/**
 * Which plugin surfaces the shell's windows hide (ADR 0070): a plugin shown only in windows that are
 * wholly covered by windows drawn above them, or off the screen, is out of sight, and the runtime may
 * unload its frame. Pure, from the store's state and the screen's size; the stacking order is the
 * one the windows are drawn in.
 */
import type { SurfacePlacement } from "../modes/types";
import { windowsOf } from "../shell/actions";
import type { DeskState } from "../shell/state";
import { ORIGIN, screenRect } from "./coordinates";
import type { Rect } from "./geometry";
import { leaves, panesOf } from "./tree";
import { resolveView } from "./views";

/** A window's stacking level: the focused one on top, pinned ones above the rest, in desk order. */
export function zOf(p: SurfacePlacement, index: number, focused: string | null): number {
  return p.id === focused ? 100 : p.pinned ? 50 + index : 1 + index;
}

/** The plugin ids out of sight on the current desktop, of those its windows show. */
export function coveredPlugins(s: DeskState, vw: number, vh: number): Set<string> {
  const pan = s.pan[s.desktop] ?? ORIGIN;
  const screen = { x: 0, y: 0, w: vw, h: vh };
  const windows = windowsOf(s).map((p, i) => ({
    rect: clip(screenRect(p, pan, vw, vh), screen),
    z: zOf(p, i, s.focused),
    plugins: leaves(panesOf(p))
      .map((leaf) => resolveView(s, p, leaf.view))
      .filter((view) => view.startsWith("plugin:"))
      .map((view) => view.slice("plugin:".length)),
  }));
  const hidden = new Set<string>();
  const seen = new Set<string>();
  for (const w of windows) {
    const above = windows.filter((o) => o.z > w.z).map((o) => o.rect);
    const out = w.rect === undefined || covers(above, w.rect);
    for (const id of w.plugins) {
      if (!out) seen.add(id);
      else if (!seen.has(id)) hidden.add(id);
    }
  }
  for (const id of seen) hidden.delete(id);
  return hidden;
}

/** The part of `r` inside `bounds`, or undefined when nothing is. */
function clip(r: Rect, bounds: Rect): Rect | undefined {
  const x = Math.max(r.x, bounds.x);
  const y = Math.max(r.y, bounds.y);
  const w = Math.min(r.x + r.w, bounds.x + bounds.w) - x;
  const h = Math.min(r.y + r.h, bounds.y + bounds.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : undefined;
}

/** Whether the rects in `cover` together cover all of `target`: every cell between their edges. */
function covers(cover: Array<Rect | undefined>, target: Rect): boolean {
  const rects = cover.flatMap((r) => (r ? [clip(r, target)] : [])).filter((r) => r !== undefined);
  if (rects.length === 0) return false;
  const edges = (start: (r: Rect) => number, size: (r: Rect) => number, from: number, to: number) =>
    [...new Set([from, to, ...rects.flatMap((r) => [start(r), start(r) + size(r)])])]
      .filter((v) => v >= from && v <= to)
      .sort((a, b) => a - b);
  const xs = edges(
    (r) => r.x,
    (r) => r.w,
    target.x,
    target.x + target.w,
  );
  const ys = edges(
    (r) => r.y,
    (r) => r.h,
    target.y,
    target.y + target.h,
  );
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      const cx = ((xs[i] ?? 0) + (xs[i + 1] ?? 0)) / 2;
      const cy = ((ys[j] ?? 0) + (ys[j + 1] ?? 0)) / 2;
      const inside = (r: Rect) => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h;
      if (!rects.some(inside)) return false;
    }
  }
  return true;
}
