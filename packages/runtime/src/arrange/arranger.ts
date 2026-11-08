/**
 * Tile and cascade over the store (ADR 0116): which windows they move, one session edit of the
 * current desktop for the lot, and a history per desktop of the geometry they replaced, which
 * "Restore previous layout" and the desk's undo (ADR 0077) put back.
 */
import type { DesktopId, DesktopLayout, SurfacePlacement } from "../modes/types";
import { type Ctx, desktopId, layoutOf, windowsOf } from "../shell/actions";
import { panOf } from "../shell/Pan";
import type { DeskState } from "../shell/state";
import { appSize, isFloating } from "../surface/coordinates";
import type { Rect } from "../surface/geometry";
import { GAP } from "../surface/tiling";
import { arrangeArea, cascadeRects, tileRects } from "./geometry";

/** Desktops by their stable id (ADR 0117), so a history survives a rename or a reorder. */
export type Desktop = DesktopId;
export type Kind = "tile" | "cascade";

/** A window's geometry as an arrangement found it. */
export interface Kept {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: SurfacePlacement["fill"];
  restore?: SurfacePlacement["restore"];
}

/** What an arrangement answers: the undo stack keeps it and hands it back to the restore. */
export interface Arranged {
  desktop: Desktop;
  entry: string;
  kind: Kind;
  windows: Kept[];
}

interface Entry extends Arranged {
  /** The desktop's session layer before, absent when it had none. */
  session?: DesktopLayout;
  /** The desktop's layout right after, to tell whether anything changed since. */
  after: string;
}

/** How many arrangements each desktop remembers. */
export const HISTORY = 20;

/** Tile and cascade move normal windows that are not pinned; floating and pinned ones stay put. */
export function arrangeable(s: DeskState): SurfacePlacement[] {
  return windowsOf(s).filter((p) => !isFloating(p) && !p.pinned);
}

const keep = (p: SurfacePlacement): Kept => ({
  id: p.id,
  x: p.x,
  y: p.y,
  w: p.w,
  h: p.h,
  ...(p.fill ? { fill: p.fill } : {}),
  ...(p.restore ? { restore: { ...p.restore } } : {}),
});

/** A placement at `rect` on the canvas, no longer filling anything. */
function placed(p: SurfacePlacement, rect: Rect): SurfacePlacement {
  const { fill: _fill, restore: _restore, ...rest } = p;
  return { ...rest, ...rect };
}

/** A placement back at the geometry an arrangement kept. */
function back(p: SurfacePlacement, k: Kept): SurfacePlacement {
  const { fill: _fill, restore: _restore, ...rest } = p;
  return {
    ...rest,
    x: k.x,
    y: k.y,
    w: k.w,
    h: k.h,
    ...(k.fill ? { fill: k.fill } : {}),
    ...(k.restore ? { restore: { ...k.restore } } : {}),
  };
}

/** The gap between tiles: the design system's third space step (12 px by default). */
export function tileGap(): number {
  if (typeof document === "undefined") return GAP;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--desk-space-3");
  const px = Number.parseFloat(value);
  return Number.isFinite(px) && px >= 0 ? px : GAP;
}

export interface ArrangerOptions {
  /** The app's size in pixels; the shell's by default. */
  size?: () => { vw: number; vh: number };
  gap?: () => number;
}

export class Arranger {
  readonly #ctx: Ctx;
  readonly #size: () => { vw: number; vh: number };
  readonly #gap: () => number;
  readonly #history = new Map<Desktop, Entry[]>();
  /** Entries already put back, so the undo stack's copy of one does nothing twice. */
  readonly #restored = new Set<string>();
  readonly #listeners = new Set<() => void>();
  #count = 0;

  constructor(ctx: Ctx, options: ArrangerOptions = {}) {
    this.#ctx = ctx;
    this.#size = options.size ?? appSize;
    this.#gap = options.gap ?? tileGap;
  }

  /** Lay the current desktop's normal windows out; undefined when there is none to move. */
  arrange(kind: Kind): Arranged | undefined {
    const s = this.#ctx.store.get();
    const windows = order(arrangeable(s), kind, s.focused);
    if (windows.length === 0) return undefined;
    const { vw, vh } = this.#size();
    const layout = layoutOf(s);
    const area = arrangeArea(vw, vh, layout.eris === null);
    const rects =
      kind === "tile"
        ? tileRects(windows.length, area, this.#gap())
        : cascadeRects(windows.length, area);
    const pan = panOf(s);
    const to = new Map(
      windows.map((p, i) => {
        const r = rects[i] ?? area;
        return [p.id, { x: r.x - pan.x, y: r.y - pan.y, w: r.w, h: r.h }];
      }),
    );
    const desktop = desktopId(s);
    const before = s.session[desktop];
    this.#ctx.store.set((st) => {
      const next = structuredClone(layoutOf(st, desktop));
      const own = new Map(next.surfaces.map((p) => [p.id, p]));
      // The arranged windows go last, in the order they took their places: the stacking (desk
      // order, ADR 0082) then follows the cascade down whichever window has the focus later. A
      // plugin window no layout placed yet enters it here (ADR 0040).
      const moved = windows.map((p) => placed(own.get(p.id) ?? p, to.get(p.id) ?? area));
      const rest = next.surfaces.filter((p) => !to.has(p.id));
      return { session: { ...st.session, [desktop]: { ...next, surfaces: [...rest, ...moved] } } };
    });
    const entry: Entry = {
      desktop,
      entry: `${kind}-${this.#ctx.wall()}-${++this.#count}`,
      kind,
      windows: windows.map(keep),
      ...(before ? { session: structuredClone(before) } : {}),
      after: JSON.stringify(layoutOf(this.#ctx.store.get(), desktop)),
    };
    const list = [...(this.#history.get(desktop) ?? []), entry].slice(-HISTORY);
    this.#history.set(desktop, list);
    this.#changed();
    const { session: _session, after: _after, ...answer } = entry;
    return structuredClone(answer);
  }

  /** Whether `desktop` (the current one by default) has an arrangement to put back. */
  canRestore(desktop?: Desktop): boolean {
    const id = desktop ?? desktopId(this.#ctx.store.get());
    return (this.#history.get(id)?.length ?? 0) > 0;
  }

  /**
   * Put an arrangement back: the one an undo names (`from`, an arrangement's answer), else the
   * current desktop's latest. When nothing changed on its desktop since, the desktop comes back
   * exactly as it was, unsaved edits included; otherwise each window still there takes its kept
   * geometry. Answers what it put back, or undefined when there was nothing.
   */
  restore(
    from?: Partial<Arranged>,
  ): { desktop: Desktop; entry: string; windows: number } | undefined {
    const entry = from?.entry ? this.#take(from) : this.#pop(desktopId(this.#ctx.store.get()));
    if (!entry) return;
    this.#restored.add(entry.entry);
    const { desktop } = entry;
    const s = this.#ctx.store.get();
    if (entry.after && JSON.stringify(layoutOf(s, desktop)) === entry.after) {
      this.#ctx.store.set((st) => {
        const session = { ...st.session };
        if (entry.session) session[desktop] = structuredClone(entry.session);
        else delete session[desktop];
        return { session };
      });
    } else {
      const kept = new Map(entry.windows.map((k) => [k.id, k]));
      this.#ctx.store.set((st) => {
        const next = structuredClone(layoutOf(st, desktop));
        const surfaces = next.surfaces.map((p) => {
          const k = kept.get(p.id);
          return k ? back(p, k) : p;
        });
        return { session: { ...st.session, [desktop]: { ...next, surfaces } } };
      });
    }
    this.#changed();
    return { desktop, entry: entry.entry, windows: entry.windows.length };
  }

  /** Hear the history change (an arrangement, a restore). */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #pop(desktop: Desktop): Entry | undefined {
    const list = this.#history.get(desktop);
    const entry = list?.pop();
    return entry;
  }

  /**
   * The entry an undo names, out of its desktop's history. One this desk no longer holds (the page
   * was reloaded under a core that kept its undo stack) comes back from the answer itself, its
   * geometry only; one already put back does nothing.
   */
  #take(from: Partial<Arranged>): Entry | undefined {
    const id = String(from.entry);
    if (this.#restored.has(id)) return;
    for (const list of this.#history.values()) {
      const at = list.findIndex((e) => e.entry === id);
      if (at >= 0) return list.splice(at, 1)[0];
    }
    if (!Array.isArray(from.windows) || from.desktop === undefined) return;
    return {
      desktop: String(from.desktop),
      entry: id,
      kind: from.kind === "cascade" ? "cascade" : "tile",
      windows: from.windows.filter(isKept),
      after: "",
    };
  }

  #changed(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}

/**
 * The order windows take the places in: desk order, so the stacking follows the cascade down and
 * a grid reads as the desk did; a cascade puts the focused window last, where it ends on top.
 */
function order(windows: SurfacePlacement[], kind: Kind, focused: string | null) {
  if (kind === "tile") return windows;
  const top = windows.filter((p) => p.id === focused);
  return [...windows.filter((p) => p.id !== focused), ...top];
}

const isKept = (k: unknown): k is Kept => {
  const v = k as Record<string, unknown> | null;
  return (
    typeof v?.id === "string" &&
    ["x", "y", "w", "h"].every((key) => typeof v[key] === "number" && Number.isFinite(v[key]))
  );
};
