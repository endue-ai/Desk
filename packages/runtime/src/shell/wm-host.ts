/**
 * A host that runs the window manager's gestures and window commands itself: the CEF shell's
 * compositor, where crates/desk-wm drags, resizes, snaps and pans windows on the compositor's input
 * (#80, ADR 0153). The page's DOM still finds what a press lands on, as the gestures' handlers
 * accept it, and says so (`grab`); the host runs the gesture and publishes each change it makes,
 * which the runtime takes as the truth for geometry (`takeWm`). While a gesture holds a window, the
 * page lays the window out where it is held (`HeldWindows`), so what the page draws of it follows.
 * The windowed desk has no host: the runtime's own window manager does all of it.
 */
import type { SurfacePlacement } from "../modes/types";
import type { Rect } from "../surface/geometry";
import type { ResizeDirection } from "../surface/resize";
import type { Fill } from "../surface/snap";
import { desktopId, editAt, ensurePlaced } from "./actions";
import type { ShellCtx } from "./context";

/** What a press starts, as the page found it. */
export type Grab =
  | { kind: "move"; window: string }
  | { kind: "resize"; window: string; grip: ResizeDirection }
  | { kind: "pan" };

/** A window command (desk.display.*). */
export type WindowOp =
  | { op: "maximize" }
  | { op: "snap"; fill: Fill }
  | { op: "move"; dx: number; dy: number }
  | { op: "resize"; dw: number; dh: number };

export interface WindowManagerHost {
  /** The press at `at` (CSS pixels of the page) starts `grab`. */
  grab(grab: Grab, at: { x: number; y: number }): void;
  /** Run `op` on window `window`, or on the one in use. */
  run(op: WindowOp, window?: string): void;
}

/** A window's geometry as the host leaves it. */
export interface WmGeometry {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floating?: boolean;
  fill?: Fill;
  restore?: SurfacePlacement["restore"];
}

/** What the host changed (`desk://compositor-wm`). */
export interface WmPublished {
  rev: number;
  desktop: string;
  windows?: WmGeometry[];
  pan?: { x: number; y: number };
}

/**
 * Take what the host published as the truth: each window's geometry and the canvas's pan, as
 * session edits of their desktop.
 */
export function takeWm(ctx: ShellCtx, published: WmPublished): void {
  const s = ctx.store.get();
  const desktop = desktopId(s, published.desktop);
  for (const g of published.windows ?? []) {
    const geometry: Partial<SurfacePlacement> = {
      x: g.x,
      y: g.y,
      w: g.w,
      h: g.h,
      floating: g.floating,
      fill: g.fill,
      restore: g.restore,
    };
    if (desktop === desktopId(ctx.store.get())) ensurePlaced(ctx, g.id);
    editAt(ctx, desktop, (l) => ({
      ...l,
      surfaces: l.surfaces.map((p) => (p.id === g.id ? { ...p, ...geometry } : p)),
    }));
  }
  if (published.pan) {
    const pan = published.pan;
    ctx.store.set((state) => ({ pan: { ...state.pan, [desktop]: pan } }));
  }
}

/** Where the page lays out the window a host's gesture holds, if one. */
export interface HeldWindows {
  rect(id: string): Rect | undefined;
  /** Window `id` is held at `rect`; `null` lets every window go. */
  hold(id: string | null, rect?: Rect): void;
  onChange(listener: () => void): () => void;
}

export function heldWindows(): HeldWindows {
  let held: { id: string; rect: Rect } | undefined;
  const listeners = new Set<() => void>();
  return {
    rect: (id) => (held?.id === id ? held.rect : undefined),
    hold(id, rect) {
      held = id && rect ? { id, rect } : undefined;
      for (const listener of [...listeners]) listener();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
