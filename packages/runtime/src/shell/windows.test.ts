import { describe, expect, it, vi } from "vitest";
import { screenRect } from "../surface/coordinates";
import { zOf } from "../surface/cover";
import { slotRect } from "../surface/tiling";
import { layoutOf, moveSurface, openSurface, windowsOf } from "./actions";
import { Store, sampleState } from "./state";
import { closeWindow, newWindow, showPlugin, toggleFloating } from "./windows";

// Maximizing and snapping are the window manager's (crates/desk-wm's tests/fill.rs, snap.rs and
// interactions.rs, ADR 0153); the runtime's own went with the windowed desk (#83).
const epoch = Date.parse("2026-10-28T09:00:00.000Z");

function ctx() {
  const store = new Store(sampleState("en", epoch));
  const unmount = vi.fn((id: string) =>
    store.set((s) => ({ adopted: s.adopted.filter((a) => a.id !== id) })),
  );
  return {
    store,
    unmount,
    runtime: { shortcuts: { focused: null }, focusSurface() {}, plugins: { unmount } } as never,
    bridge: undefined as never,
    now: () => 1000,
    wall: () => epoch + 1000,
    tr: (key: string) => key,
  };
}

/** Three plugin surfaces handed over, in slots 0 to 2, none placed by the layout. */
function adopt(c: ReturnType<typeof ctx>, ids = ["p.a", "p.b", "p.c"]) {
  c.store.set({ adopted: ids.map((id, slot) => ({ id, title: id, slot })) });
}
const rectOf = (c: ReturnType<typeof ctx>, id: string) => {
  const p = windowsOf(c.store.get()).find((w) => w.id === id);
  return p && { x: p.x, y: p.y, w: p.w, h: p.h };
};

describe("plugin windows in their slots", () => {
  it("revealing a plugin focuses its own window and leaves an empty launcher alone", () => {
    const c = ctx();
    adopt(c);
    const launcher = newWindow(c);
    showPlugin(c, "p.a");
    expect(c.store.get().focused).toBe("p.a");
    expect(windowsOf(c.store.get()).find((p) => p.id === launcher)?.panes).toMatchObject({
      view: "launcher",
    });
  });
  it("moving one leaves every other window where it was, at its size", () => {
    const c = ctx();
    adopt(c);
    const b = rectOf(c, "p.b");
    const cc = rectOf(c, "p.c");
    expect(b).toEqual(slotRect(1));
    moveSurface(c, "p.a", { x: 700, y: 500, w: 300, h: 200 });
    expect(rectOf(c, "p.a")).toEqual({ x: 700, y: 500, w: 300, h: 200 });
    expect(rectOf(c, "p.b")).toEqual(b);
    expect(rectOf(c, "p.c")).toEqual(cc);
  });

  it("closing one leaves the others where they were", () => {
    const c = ctx();
    adopt(c);
    const cc = rectOf(c, "p.c");
    closeWindow(c, "p.b");
    expect(c.unmount).toHaveBeenCalledWith("p.b");
    expect(rectOf(c, "p.b")).toBeUndefined();
    expect(rectOf(c, "p.c")).toEqual(cc);
  });
});

describe("closing a window", () => {
  it("takes a moved plugin window out of the layout and unmounts the plugin", () => {
    const c = ctx();
    adopt(c);
    moveSurface(c, "p.a", { x: 700, y: 500 });
    expect(layoutOf(c.store.get()).surfaces.some((p) => p.id === "p.a")).toBe(true);
    closeWindow(c, "p.a");
    expect(c.unmount).toHaveBeenCalledWith("p.a");
    expect(layoutOf(c.store.get()).surfaces.some((p) => p.id === "p.a")).toBe(false);
    expect(windowsOf(c.store.get()).some((p) => p.id === "p.a")).toBe(false);
  });

  it("a placed window whose plugin went away otherwise is not drawn, and comes back with it", () => {
    const c = ctx();
    adopt(c);
    moveSurface(c, "p.a", { x: 700, y: 500 });
    c.store.set((s) => ({ adopted: s.adopted.filter((a) => a.id !== "p.a") }));
    expect(windowsOf(c.store.get()).some((p) => p.id === "p.a")).toBe(false);
    adopt(c);
    expect(rectOf(c, "p.a")).toMatchObject({ x: 700, y: 500 });
  });

  it("closes a shell view's window without unmounting anything", () => {
    const c = ctx();
    openSurface(c, "calendar");
    closeWindow(c, "calendar");
    expect(layoutOf(c.store.get()).surfaces).toHaveLength(0);
    expect(c.unmount).not.toHaveBeenCalled();
  });
});

describe("normal and floating windows", () => {
  const PAN = { x: -500, y: -300 };
  const onScreen = (c: ReturnType<typeof ctx>, id: string) => {
    const p = windowsOf(c.store.get()).find((w) => w.id === id);
    return p && screenRect(p, c.store.get().pan[1] ?? { x: 0, y: 0 }, 1440, 900);
  };

  it("a new window opens in normal mode, in sight of a panned canvas", () => {
    const c = ctx();
    c.store.set({ pan: { 1: PAN } });
    const id = newWindow(c);
    const p = layoutOf(c.store.get()).surfaces.find((w) => w.id === id);
    expect(p?.floating).toBeUndefined();
    expect(onScreen(c, id)).toMatchObject({ x: 480, y: 240 });
    // Then it moves with the canvas.
    c.store.set({ pan: { 1: { x: 0, y: 0 } } });
    expect(onScreen(c, id)).toMatchObject({ x: 980, y: 540 });
  });

  it("a plugin window arriving on a panned canvas takes its slot in sight", () => {
    const c = ctx();
    c.store.set({ pan: { 1: PAN }, adopted: [{ id: "p.a", title: "A", slot: 0, at: PAN }] });
    expect(onScreen(c, "p.a")).toMatchObject({ x: slotRect(0).x, y: slotRect(0).y });
  });

  it("a floating window stays where it is on screen whatever the pan", () => {
    const c = ctx();
    const id = newWindow(c);
    toggleFloating(c, id, { vw: 1440, vh: 900 });
    const before = onScreen(c, id);
    c.store.set({ pan: { 1: PAN } });
    expect(onScreen(c, id)).toEqual(before);
  });

  it("stacks floating windows above every normal one, even a focused one", () => {
    const normal = { id: "n", plugin: "x", x: 0, y: 0, w: 1, h: 1, pinned: true };
    const floating = { ...normal, id: "f", pinned: false, floating: true };
    expect(zOf(floating, 0, "n")).toBeGreaterThan(zOf(normal, 1, "n"));
  });
});

describe("plugin windows across desktops (ADR 0117)", () => {
  it("one moved on a desktop lives there; showing its plugin goes to that desktop", () => {
    const c = ctx();
    adopt(c);
    moveSurface(c, "p.a", { x: 700, y: 500 });
    expect(windowsOf(c.store.get(), "2").some((p) => p.id === "p.a")).toBe(false);
    // The others, in their slots, are on every desktop until moved.
    expect(windowsOf(c.store.get(), "2").some((p) => p.id === "p.b")).toBe(true);
    c.store.set({ desktop: "2" });
    showPlugin(c, "p.a");
    expect(c.store.get().desktop).toBe("1");
    expect(c.store.get().focused).toBe("p.a");
    expect(layoutOf(c.store.get(), "2").surfaces.some((p) => p.id === "p.a")).toBe(false);
  });
});
