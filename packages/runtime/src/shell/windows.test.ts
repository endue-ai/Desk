import { describe, expect, it, vi } from "vitest";
import { screenRect } from "../surface/coordinates";
import { zOf } from "../surface/cover";
import { slotRect } from "../surface/tiling";
import { layoutOf, moveSurface, openSurface, windowsOf } from "./actions";
import { Store, sampleState } from "./state";
import { closeWindow, newWindow, snapTo, toggleFloating, toggleMaximize } from "./windows";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");
const WHOLE = { x: 0, y: 0, w: 1440, h: 900 };

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

describe("maximize", () => {
  it("fills the whole app and keeps the place to restore; a second call restores it", () => {
    const c = ctx();
    openSurface(c, "calendar");
    const before = layoutOf(c.store.get()).surfaces[0];
    toggleMaximize(c, "calendar");
    const full = layoutOf(c.store.get()).surfaces[0];
    expect(full).toMatchObject({
      ...WHOLE,
      fill: "full",
      restore: { x: before?.x, y: before?.y, w: before?.w, h: before?.h },
    });
    toggleMaximize(c, "calendar");
    const back = layoutOf(c.store.get()).surfaces[0];
    expect(back).toMatchObject({ x: before?.x, y: before?.y, w: before?.w, h: before?.h });
    expect(back?.restore).toBeUndefined();
    expect(back?.fill).toBeUndefined();
  });

  it("a half snapped window fills the app, and comes back to its half", () => {
    const c = ctx();
    openSurface(c, "calendar");
    snapTo(c, "calendar", "left");
    const half = layoutOf(c.store.get()).surfaces[0];
    expect(half).toMatchObject({ x: 0, y: 0, h: 900, fill: "left" });
    expect(half?.restore).toBeUndefined();
    toggleMaximize(c, "calendar");
    expect(layoutOf(c.store.get()).surfaces[0]).toMatchObject({ ...WHOLE, fill: "full" });
    toggleMaximize(c, "calendar");
    expect(layoutOf(c.store.get()).surfaces[0]).toMatchObject({ x: 0, y: 0, w: half?.w, h: 900 });
  });

  it("dropping at the top fills the app and can be restored like a maximize", () => {
    const c = ctx();
    openSurface(c, "calendar");
    const before = layoutOf(c.store.get()).surfaces[0];
    snapTo(c, "calendar", "full");
    expect(layoutOf(c.store.get()).surfaces[0]).toMatchObject({ ...WHOLE, fill: "full" });
    toggleMaximize(c, "calendar");
    expect(layoutOf(c.store.get()).surfaces[0]).toMatchObject({ x: before?.x, w: before?.w });
  });
});

describe("plugin windows in their slots", () => {
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
