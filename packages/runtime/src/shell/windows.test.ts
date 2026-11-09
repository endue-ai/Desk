import { describe, expect, it, vi } from "vitest";
import { screenRect } from "../surface/coordinates";
import { zOf } from "../surface/cover";
import { slotRect } from "../surface/tiling";
import { edit, layoutOf, moveSurface, openSurface, windowsOf } from "./actions";
import { Store, sampleState } from "./state";
import {
  closeWindow,
  newWindow,
  showPlugin,
  snapTo,
  toggleFloating,
  toggleMaximize,
  unfilled,
} from "./windows";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");
/**
 * The free area at 1440×900, what a filled window takes: between the side bars, the rail and the
 * bottom line, and under Eris in her default place. Once she is moved it reaches up to the chips.
 */
const FREE = { x: 104, y: 190, w: 1232, h: 622 };
const FREE_ERIS_MOVED = { x: 104, y: 72, w: 1232, h: 740 };

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
  it("fills the app between the bars and keeps the place to restore; a second call restores it", () => {
    const c = ctx();
    openSurface(c, "calendar");
    const before = layoutOf(c.store.get()).surfaces[0];
    toggleMaximize(c, "calendar");
    const full = layoutOf(c.store.get()).surfaces[0];
    expect(full).toMatchObject({
      ...FREE,
      fill: "full",
      restore: { x: before?.x, y: before?.y, w: before?.w, h: before?.h },
    });
    toggleMaximize(c, "calendar");
    const back = layoutOf(c.store.get()).surfaces[0];
    expect(back).toMatchObject({ x: before?.x, y: before?.y, w: before?.w, h: before?.h });
    expect(back?.restore).toBeUndefined();
    expect(back?.fill).toBeUndefined();
  });

  it("a half snapped window fills its half between the bars; maximized from there, it comes back to the half", () => {
    const c = ctx();
    openSurface(c, "calendar");
    const before = layoutOf(c.store.get()).surfaces[0];
    snapTo(c, "calendar", "left");
    const half = layoutOf(c.store.get()).surfaces[0];
    expect(half).toMatchObject({ x: FREE.x, y: FREE.y, w: 610, h: FREE.h, fill: "left" });
    snapTo(c, "calendar", "right");
    expect(layoutOf(c.store.get()).surfaces[0]).toMatchObject({
      x: FREE.x + FREE.w - 610,
      y: FREE.y,
      w: 610,
      h: FREE.h,
      fill: "right",
    });
    snapTo(c, "calendar", "left");
    toggleMaximize(c, "calendar");
    expect(layoutOf(c.store.get()).surfaces[0]).toMatchObject({ ...FREE, fill: "full" });
    toggleMaximize(c, "calendar");
    const again = layoutOf(c.store.get()).surfaces[0];
    if (!again || !before) throw new Error("no window");
    expect(again).toMatchObject({ x: FREE.x, y: FREE.y, w: 610, h: FREE.h, fill: "left" });
    // Its own place is still the one a drag out of the half comes back to.
    const own = { x: before.x, y: before.y, w: before.w, h: before.h };
    expect(again.restore).toEqual({ ...own, floating: false });
    expect(unfilled(again)).toMatchObject(own);
    expect(unfilled(again).fill).toBeUndefined();
  });

  it("dropping at the top fills the app between the bars and can be restored like a maximize", () => {
    const c = ctx();
    openSurface(c, "calendar");
    const before = layoutOf(c.store.get()).surfaces[0];
    snapTo(c, "calendar", "full");
    expect(layoutOf(c.store.get()).surfaces[0]).toMatchObject({ ...FREE, fill: "full" });
    toggleMaximize(c, "calendar");
    expect(layoutOf(c.store.get()).surfaces[0]).toMatchObject({ x: before?.x, w: before?.w });
  });

  it("fills the same place on screen at any pan, and a floating window at any app size", () => {
    const c = ctx();
    openSurface(c, "calendar");
    const pan = { x: -100, y: -50 };
    c.store.set((s) => ({ pan: { ...s.pan, [s.desktop]: pan } }));
    toggleMaximize(c, "calendar");
    const normal = layoutOf(c.store.get()).surfaces[0];
    if (!normal) throw new Error("no window");
    expect(screenRect(normal, pan, 1440, 900)).toEqual(FREE);
    toggleMaximize(c, "calendar");
    toggleFloating(c, "calendar", { vw: 1440, vh: 900 });
    toggleMaximize(c, "calendar");
    const floating = layoutOf(c.store.get()).surfaces[0];
    if (!floating) throw new Error("no window");
    expect(screenRect(floating, pan, 1440, 900)).toEqual(FREE);
    expect(screenRect(floating, pan, 1280, 800)).toEqual({ x: 104, y: 190, w: 1072, h: 522 });
  });

  it("reaches up to the chips once Eris has left her default place", () => {
    const c = ctx();
    openSurface(c, "calendar");
    edit(c, (l) => ({ ...l, eris: { x: 600, y: 700 } }));
    toggleMaximize(c, "calendar");
    expect(layoutOf(c.store.get()).surfaces[0]).toMatchObject({ ...FREE_ERIS_MOVED, fill: "full" });
    snapTo(c, "calendar", "right");
    expect(layoutOf(c.store.get()).surfaces[0]).toMatchObject({ x: 726, y: 72, w: 610, h: 740 });
  });
});

describe("snapping to halves and quarters", () => {
  const top = { x: FREE.x, y: FREE.y, w: FREE.w, h: 305 };
  const parts = {
    top,
    bottom: { ...top, y: 507 },
    "top-left": { x: 104, y: 190, w: 610, h: 305 },
    "top-right": { x: 726, y: 190, w: 610, h: 305 },
    "bottom-left": { x: 104, y: 507, w: 610, h: 305 },
    "bottom-right": { x: 726, y: 507, w: 610, h: 305 },
  } as const;

  for (const [fill, rect] of Object.entries(parts)) {
    it(`${fill} takes its part of the free area, at any app size`, () => {
      const c = ctx();
      openSurface(c, "calendar");
      snapTo(c, "calendar", fill as keyof typeof parts);
      const p = layoutOf(c.store.get()).surfaces[0];
      if (!p) throw new Error("no window");
      expect(p).toMatchObject({ ...rect, fill, floating: true });
      expect(screenRect(p, { x: 0, y: 0 }, 1440, 900)).toEqual(rect);
      // A taller and wider app: the part grows with the free area, from the same top.
      const big = screenRect(p, { x: 0, y: 0 }, 2000, 1200);
      expect(big.y).toBe(fill.startsWith("bottom") ? 190 + 455 + 12 : 190);
      expect(big.h).toBe(455);
      expect(big.w).toBe(fill.includes("-") ? 890 : 1792);
    });
  }

  it("a snapped normal window floats, so a pan leaves it where it was snapped", () => {
    const c = ctx();
    openSurface(c, "calendar");
    expect(layoutOf(c.store.get()).surfaces[0]?.floating).not.toBe(true);
    snapTo(c, "calendar", "top-left");
    const p = layoutOf(c.store.get()).surfaces[0];
    if (!p) throw new Error("no window");
    expect(p.floating).toBe(true);
    expect(screenRect(p, { x: -400, y: 250 }, 1440, 900)).toEqual(parts["top-left"]);
    expect(screenRect(p, { x: 0, y: 0 }, 1440, 900)).toEqual(parts["top-left"]);
  });

  it("keeps the place and the mode to come back to through every later snap", () => {
    const c = ctx();
    openSurface(c, "calendar");
    const before = layoutOf(c.store.get()).surfaces[0];
    snapTo(c, "calendar", "bottom");
    snapTo(c, "calendar", "top-right");
    snapTo(c, "calendar", "left");
    expect(layoutOf(c.store.get()).surfaces[0]?.restore).toEqual({
      x: before?.x,
      y: before?.y,
      w: before?.w,
      h: before?.h,
      floating: false,
    });
  });

  it("out of its fill, a window is back at its place in the mode it had; a floating one stays floating", () => {
    const c = ctx();
    openSurface(c, "calendar");
    const before = layoutOf(c.store.get()).surfaces[0];
    snapTo(c, "calendar", "right");
    const snapped = layoutOf(c.store.get()).surfaces[0];
    if (!snapped || !before) throw new Error("no window");
    const back = unfilled(snapped);
    expect(back).toMatchObject({ x: before.x, y: before.y, w: before.w, h: before.h });
    expect(back.floating).toBeUndefined();
    expect(back.fill).toBeUndefined();
    expect(back.restore).toBeUndefined();
    // Dropped elsewhere, it takes the drop's place in that mode.
    expect(unfilled(snapped, { x: 9, y: 8, w: 300, h: 200 })).toMatchObject({ x: 9, w: 300 });
    // The title bar's Floating button takes it out of the snap as a normal window; again, it floats.
    toggleFloating(c, "calendar", { vw: 1440, vh: 900 });
    expect(layoutOf(c.store.get()).surfaces[0]).toMatchObject({ floating: false });
    expect(layoutOf(c.store.get()).surfaces[0]?.fill).toBeUndefined();
    toggleFloating(c, "calendar", { vw: 1440, vh: 900 });
    snapTo(c, "calendar", "bottom-left");
    const floating = layoutOf(c.store.get()).surfaces[0];
    if (!floating) throw new Error("no window");
    expect(unfilled(floating).floating).toBe(true);
  });

  it("a window maximized before snaps floated keeps its own mode when it comes back", () => {
    const c = ctx();
    openSurface(c, "calendar");
    edit(c, (l) => ({
      ...l,
      surfaces: l.surfaces.map((p) => ({
        ...p,
        ...FREE,
        fill: "full" as const,
        restore: { x: 400, y: 300, w: 480, h: 320 },
      })),
    }));
    toggleMaximize(c, "calendar");
    const back = layoutOf(c.store.get()).surfaces[0];
    expect(back).toMatchObject({ x: 400, y: 300, w: 480, h: 320 });
    expect(back?.floating).toBeUndefined();
  });
});

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
