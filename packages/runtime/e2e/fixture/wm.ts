// What crates/desk-wm does when a window is moved, resized, filled or the canvas panned (ADR 0153),
// for the shell fixture: this page has no compositor, so a spec that needs a window somewhere else
// asks the page's desk-wm (WebAssembly, `wm-host.ts`) for it, by the window command a key would run
// or the geometry a gesture leaves (#83). Gestures and the window commands themselves are desk-wm's,
// tested in crates/desk-wm and by the app e2e on the desk (`e2e/specs/windows-*.spec.ts`). Never
// shipped.
import type { DesktopLayout, DesktopRef } from "../../src/modes/types";
import { desktopId, desktopsOf, windowsOf } from "../../src/shell/actions";
import type { Desk } from "../../src/shell/Desk";
import type { LocalWindowManager } from "../../src/wm/local";
import type { Fill, Geometry } from "../../src/wm/types";

export interface FixtureWm {
  /** Window `id` at `rect`, in its mode, out of any fill. */
  place(id: string, rect: { x: number; y: number; w: number; h: number }): Promise<void>;
  /** Window `id` moved by `dx`, `dy`, in its mode. */
  move(id: string, dx: number, dy?: number): Promise<void>;
  /** Window `id` filling `where`, as desk.display.snap-* and maximize do. */
  fill(id: string, where: Fill): Promise<void>;
  /** Window `id` back from its fill: to the part it filled the app from, or to its own place. */
  unfill(id: string): Promise<void>;
  /** The canvas of the desktop in front panned to `x`, `y`. */
  pan(x: number, y: number): Promise<void>;
  /** The canvas of the desktop in front panned by `dx`, `dy`. */
  panBy(dx: number, dy: number): Promise<void>;
  /** Desktop `desktop` (an id, or a position from 1) in front, nothing focused there. */
  desktop(desktop: DesktopRef): Promise<void>;
  /** The session's moves are `session`, by desktop id, as desk.shell.layouts would bring them. */
  session(session: Record<string, DesktopLayout>): Promise<void>;
  /** Window `window` of the desktop in front in use. */
  focus(window: string): Promise<void>;
  /**
   * The windows that keep a live frame, as the compositor's live budget would decide them (ADR
   * 0151); `undefined`: every window, this page's own rule.
   */
  keep(ids: string[] | undefined): void;
}

export function fixtureWm(desk: Pick<Desk, "store">, wm: LocalWindowManager): FixtureWm {
  const placement = (id: string) => {
    const p = windowsOf(desk.store.get()).find((w) => w.id === id);
    if (!p) throw new Error(`no window ${id}`);
    return p;
  };
  const own = (id: string): Geometry => {
    const { x, y, w, h, floating } = placement(id);
    return { id, x, y, w, h, ...(floating ? { floating } : {}) };
  };
  const set = async (geometry: Geometry) => {
    await wm.edit([{ op: "set-geometry", geometry }]);
  };
  const pan = async (to: { x: number; y: number }) => {
    await wm.edit([{ op: "pan", to }]);
  };
  return {
    place: (id, rect) => set({ ...own(id), ...rect }),
    move(id, dx, dy = 0) {
      const p = own(id);
      return set({ ...p, x: p.x + dx, y: p.y + dy });
    },
    async fill(id, where) {
      wm.run({ op: "snap", fill: where }, id);
    },
    async unfill(id) {
      const back = placement(id).restore;
      if (!back) return;
      const { fill: part, floating, ...rect } = back;
      if (part) wm.run({ op: "snap", fill: part }, id);
      else await set({ id, ...rect, ...(floating ? { floating } : {}) });
    },
    pan: (x, y) => pan({ x, y }),
    panBy(dx, dy) {
      const s = desk.store.get();
      const now = s.pan[desktopId(s)] ?? { x: 0, y: 0 };
      return pan({ x: now.x + dx, y: now.y + dy });
    },
    async desktop(desktop) {
      await wm.edit([{ op: "set-desktop", desktop }]);
    },
    async session(session) {
      const desktops = desktopsOf(desk.store.get()).map((d) => ({
        ...d,
        ...(session[d.id] ? { layout: session[d.id] } : {}),
      }));
      await wm.edit([{ op: "moved", value: { desktops } }]);
    },
    async focus(window) {
      await wm.edit([{ op: "focus", window }]);
    },
    keep: (ids) => wm.keep(ids),
  };
}
