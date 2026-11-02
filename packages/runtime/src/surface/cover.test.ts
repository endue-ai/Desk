// Which plugin windows nobody can see (ADR 0070): wholly under windows drawn above them, or off the
// screen. The runtime unloads those frames after desk.display.unload-after.
import { describe, expect, it } from "vitest";
import type { SurfacePlacement } from "../modes/types";
import { emptyState, Store } from "../shell/state";
import { pluginWindows } from "./host";

const A = "a.one";
const B = "b.two";

/** A shell window of its own (a launcher) at x, y, w × h in the 1440 × 900 frame. */
const window_ = (id: string, x: number, y: number, w: number, h: number): SurfacePlacement => ({
  id,
  plugin: "endue.window",
  x,
  y,
  w,
  h,
  pinned: false,
  panes: { kind: "view", id: "p1", view: "launcher" },
});

/** Two plugin windows tiled side by side (104..714 and 726..1336, 190..812), plus `windows`. */
function desk(windows: SurfacePlacement[] = [], focused: string | null = null) {
  const store = new Store({
    ...emptyState("en"),
    adopted: [
      { id: A, title: "One" },
      { id: B, title: "Two" },
    ],
    session: {
      1: { surfaces: windows, eris: null, rail: { visible: true }, drawer: { visible: true } },
    },
    focused,
  });
  return { store, host: pluginWindows(store) };
}

describe("covered plugin windows", () => {
  it("tiled side by side, neither is covered", () => {
    const { host } = desk();
    expect(host.covered?.(A)).toBe(false);
    expect(host.covered?.(B)).toBe(false);
  });

  it("a window drawn above that fills the free area covers both", () => {
    const { host } = desk([window_("big", 104, 190, 1232, 622)], "big");
    expect(host.covered?.(A)).toBe(true);
    expect(host.covered?.(B)).toBe(true);
  });

  it("one that covers only part of a window leaves it visible", () => {
    const { host } = desk([window_("half", 104, 190, 400, 622)], "half");
    expect(host.covered?.(A)).toBe(false);
  });

  it("a window of the layout drawn below the tiled plugin windows covers nothing", () => {
    const { host } = desk([window_("under", 104, 190, 1232, 622)]);
    expect(host.covered?.(A)).toBe(false);
  });

  it("two pinned windows that cover it together cover it", () => {
    // Pinned windows are drawn above the tiled plugin windows; unpinned ones of the layout below.
    const left = { ...window_("left", 104, 190, 320, 622), pinned: true };
    const right = { ...window_("right", 420, 190, 300, 622), pinned: true };
    const { host } = desk([left, right]);
    expect(host.covered?.(A)).toBe(true);
    expect(host.covered?.(B)).toBe(false);
  });

  it("the window in focus is drawn on top, so nothing covers it", () => {
    const { host } = desk([window_("big", 104, 190, 1232, 622)], A);
    expect(host.covered?.(A)).toBe(false);
    expect(host.covered?.(B)).toBe(true);
  });

  it("a canvas window panned off the screen is not visible", () => {
    const { store, host } = desk();
    const away: SurfacePlacement = {
      ...window_(A, 104, 190, 400, 300),
      plugin: A,
      floating: false,
    };
    delete away.panes;
    store.set({
      session: {
        1: { surfaces: [away], eris: null, rail: { visible: true }, drawer: { visible: true } },
      },
      pan: { 1: { x: -4000, y: 0 } },
    });
    expect(host.covered?.(A)).toBe(true);
    store.set({ pan: { 1: { x: 0, y: 0 } } });
    expect(host.covered?.(A)).toBe(false);
  });

  it("tells the runtime after the store changes, once the windows are drawn", async () => {
    const { store, host } = desk();
    let heard = 0;
    const off = host.onChange?.(() => heard++);
    store.set({ focused: A });
    expect(heard).toBe(0);
    await Promise.resolve();
    expect(heard).toBe(1);
    off?.();
    store.set({ focused: B });
    await Promise.resolve();
    expect(heard).toBe(1);
  });
});
