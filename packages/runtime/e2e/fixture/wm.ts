// What crates/desk-wm publishes when it moves, resizes, fills or pans (ADR 0153), for the shell
// fixture: this page has no compositor, so a spec that needs a window somewhere else publishes the
// change desk-wm would, and the runtime takes it as it takes desk-wm's (`Desk.takeWm`). Gestures and
// the window commands themselves are desk-wm's, tested in crates/desk-wm and by the app e2e on the
// desk (`e2e/specs/windows-*.spec.ts`, #83). Never shipped.
import { desktopId, windowsOf } from "../../src/shell/actions";
import type { Desk } from "../../src/shell/Desk";
import type { WmGeometry } from "../../src/shell/wm-host";
import { REF, screenArea } from "../../src/surface/geometry";
import { type Fill, fillRect } from "../../src/surface/snap";

export interface FixtureWm {
  /** Window `id` at `rect`, in its mode, out of any fill. */
  place(id: string, rect: { x: number; y: number; w: number; h: number }): void;
  /** Window `id` moved by `dx`, `dy`. */
  move(id: string, dx: number, dy?: number): void;
  /**
   * Window `id` filling `where`, its own place kept to come back to (a snap, a maximize); filling
   * the whole app from a half or a quarter keeps that part too, as desk-wm's `fill_with` does.
   */
  fill(id: string, where: Fill): void;
  /** Window `id` back from its fill: to the part it filled the app from, or to its own place. */
  unfill(id: string): void;
  /** The canvas of the desktop in front panned to `x`, `y`. */
  pan(x: number, y: number): void;
  /** The canvas of the desktop in front panned by `dx`, `dy`. */
  panBy(dx: number, dy: number): void;
}

export function fixtureWm(desk: Pick<Desk, "store" | "takeWm">): FixtureWm {
  let rev = 0;
  const placement = (id: string) => {
    const p = windowsOf(desk.store.get()).find((w) => w.id === id);
    if (!p) throw new Error(`no window ${id}`);
    return p;
  };
  const publish = (geometry: WmGeometry) =>
    desk.takeWm({ rev: ++rev, desktop: desktopId(desk.store.get()), windows: [geometry] });
  const own = (id: string) => {
    const { x, y, w, h, floating } = placement(id);
    return { id, x, y, w, h, ...(floating ? { floating } : {}) };
  };
  return {
    place: (id, rect) => publish({ ...own(id), ...rect }),
    move(id, dx, dy = 0) {
      const p = own(id);
      publish({ ...p, x: p.x + dx, y: p.y + dy });
    },
    fill: (id, where) => fill(id, where),
    unfill(id) {
      const back = placement(id).restore;
      if (!back) return;
      const { fill: part, floating, ...rect } = back;
      if (part) fill(id, part, { ...rect, floating: floating === true });
      else publish({ id, ...rect, ...(floating ? { floating } : {}) });
    },
    pan: (x, y) => pan({ x, y }),
    panBy(dx, dy) {
      const s = desk.store.get();
      const now = s.pan[desktopId(s)] ?? { x: 0, y: 0 };
      pan({ x: now.x + dx, y: now.y + dy });
    },
  };

  function fill(id: string, where: Fill, back?: Restore) {
    const p = placement(id);
    const { fill: _part, ...own } = back ??
      p.restore ?? { x: p.x, y: p.y, w: p.w, h: p.h, floating: p.floating === true };
    const part = where === "full" && p.fill && p.fill !== "full" ? p.fill : undefined;
    const restore = part ? { ...own, fill: part } : own;
    const rect = fillRect(where, screenArea(REF.width, REF.height));
    publish({ id, ...rect, floating: true, fill: where, restore });
  }

  function pan(to: { x: number; y: number }) {
    desk.takeWm({ rev: ++rev, desktop: desktopId(desk.store.get()), pan: to });
  }
}

type Restore = NonNullable<WmGeometry["restore"]>;
