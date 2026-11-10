// The window commands (desk.display.*, ADR 0153): maximize, the eight snaps and moving and resizing
// by a step act on the window in use, with the runtime's own window manager on the windowed desk,
// and through the host that runs the window manager when there is one (the compositor). What the
// host publishes back is taken as the truth for geometry (`takeWm`), and the page lays a held
// window out where the host holds it (`heldWindows`).
import { describe, expect, it, vi } from "vitest";
import { MIN } from "../surface/geometry";
import { desktopId, layoutOf, windowsOf } from "./actions";
import type { ShellCtx } from "./context";
import { Store, sampleState } from "./state";
import { defineWindowCommands, runWindowOp, STEP, WINDOW_COMMANDS } from "./window-commands";
import { newWindow } from "./windows";
import { heldWindows, takeWm, type WindowManagerHost } from "./wm-host";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");

function ctx(wm?: WindowManagerHost) {
  const store = new Store(sampleState("en", epoch));
  return {
    store,
    runtime: { shortcuts: { focused: null }, focusSurface() {}, plugins: {} } as never,
    bridge: undefined as never,
    now: () => 1000,
    wall: () => epoch + 1000,
    tr: (key: string) => key,
    ...(wm ? { wm } : {}),
  } as unknown as ShellCtx;
}

const rectOf = (c: ShellCtx, id: string) => {
  const p = windowsOf(c.store.get()).find((w) => w.id === id);
  return p && { x: p.x, y: p.y, w: p.w, h: p.h, fill: p.fill, floating: p.floating };
};

/** The commands as `display` defines them, by id. */
function commands(c: ShellCtx): Map<string, () => unknown> {
  const all = new Map<string, () => unknown>();
  defineWindowCommands(c, (id, _title, _words, run) => all.set(id, run));
  return all;
}

describe("window commands", () => {
  it("are maximize, the eight snaps, four moves and four resizes", () => {
    expect(WINDOW_COMMANDS.map(([id]) => id)).toEqual([
      "maximize",
      "snap-left",
      "snap-right",
      "snap-top",
      "snap-bottom",
      "snap-top-left",
      "snap-top-right",
      "snap-bottom-left",
      "snap-bottom-right",
      "move-left",
      "move-right",
      "move-up",
      "move-down",
      "grow-width",
      "shrink-width",
      "grow-height",
      "shrink-height",
    ]);
  });

  it("move and resize the window in use by a step on the windowed desk", () => {
    const c = ctx();
    const id = newWindow(c);
    const start = rectOf(c, id);
    if (!start) throw new Error("no window");
    const run = commands(c);
    run.get("move-right")?.();
    run.get("move-down")?.();
    expect(rectOf(c, id)).toMatchObject({ x: start.x + STEP, y: start.y + STEP });
    run.get("grow-width")?.();
    run.get("shrink-height")?.();
    expect(rectOf(c, id)).toMatchObject({ w: start.w + STEP, h: start.h - STEP });
    for (let i = 0; i < 40; i++) run.get("shrink-width")?.();
    expect(rectOf(c, id)?.w).toBe(MIN.w);
  });

  it("move a filled window out of its fill where it is, floating", () => {
    const c = ctx();
    const id = newWindow(c);
    const run = commands(c);
    run.get("snap-bottom-right")?.();
    expect(rectOf(c, id)).toMatchObject({ x: 726, y: 456, w: 714, h: 444, fill: "bottom-right" });
    run.get("move-up")?.();
    expect(rectOf(c, id)).toEqual({ x: 726, y: 456 - STEP, w: 714, h: 444, floating: true });
    expect(layoutOf(c.store.get()).surfaces[0]?.restore).toBeUndefined();
  });

  it("go to the host that runs the window manager, named for the window in use", () => {
    const host = { grab: vi.fn(), run: vi.fn() };
    const c = ctx(host);
    const id = newWindow(c);
    const before = rectOf(c, id);
    const run = commands(c);
    run.get("snap-top-left")?.();
    run.get("maximize")?.();
    run.get("move-left")?.();
    expect(host.run.mock.calls).toEqual([
      [{ op: "snap", fill: "top-left" }, id],
      [{ op: "maximize" }, id],
      [{ op: "move", dx: -STEP, dy: 0 }, id],
    ]);
    expect(rectOf(c, id)).toEqual(before);
  });

  it("do nothing without a window in use", () => {
    const host = { grab: vi.fn(), run: vi.fn() };
    const run = commands(ctx(host));
    run.get("maximize")?.();
    expect(host.run).not.toHaveBeenCalled();
    expect(() => runWindowOp(ctx(), "nowhere", { op: "move", dx: 1, dy: 1 })).not.toThrow();
  });
});

describe("the host's changes", () => {
  it("are the truth for each window's geometry and the canvas's pan, as session edits", () => {
    const c = ctx({ grab: vi.fn(), run: vi.fn() });
    const id = newWindow(c);
    const desktop = desktopId(c.store.get());
    const restore = { x: 480, y: 240, w: 480, h: 320, floating: false };
    takeWm(c, {
      rev: 1,
      desktop,
      windows: [{ id, x: 0, y: 0, w: 714, h: 900, floating: true, fill: "left", restore }],
    });
    const p = layoutOf(c.store.get()).surfaces.find((w) => w.id === id);
    expect(p).toMatchObject({ x: 0, y: 0, w: 714, h: 900, floating: true, fill: "left", restore });
    // Dropped out of the fill: no fill, no restore, no floating.
    takeWm(c, { rev: 2, desktop, windows: [{ id, x: 600, y: 300, w: 480, h: 320 }] });
    const back = layoutOf(c.store.get()).surfaces.find((w) => w.id === id);
    expect([back?.x, back?.y, back?.fill, back?.restore, back?.floating]).toEqual([
      600,
      300,
      undefined,
      undefined,
      undefined,
    ]);
    takeWm(c, { rev: 3, desktop, pan: { x: -90, y: 40 } });
    expect(c.store.get().pan[desktop]).toEqual({ x: -90, y: 40 });
  });

  it("hold one window where the gesture holds it, until it lets go", () => {
    const held = heldWindows();
    const changed = vi.fn();
    held.onChange(changed);
    held.hold("window-1", { x: 10, y: 20, w: 300, h: 200 });
    expect(held.rect("window-1")).toEqual({ x: 10, y: 20, w: 300, h: 200 });
    expect(held.rect("window-2")).toBeUndefined();
    held.hold(null);
    expect(held.rect("window-1")).toBeUndefined();
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
