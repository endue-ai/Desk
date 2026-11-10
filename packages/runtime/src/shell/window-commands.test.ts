// The window commands (desk.display.*, ADR 0153): maximize, the eight snaps and moving and resizing
// by a step act on the window in use, through the window manager (crates/desk-wm on the compositor,
// whose tests/interactions/wm.rs runs them; the runtime's own went with the windowed desk, #83).
// What it publishes back is taken as the truth for geometry (`takeWm`), and the page lays a held
// window out where it holds it (`heldWindows`).
import { describe, expect, it, vi } from "vitest";
import { desktopId, layoutOf, windowsOf } from "./actions";
import type { ShellCtx } from "./context";
import { Store, sampleState } from "./state";
import { defineWindowCommands, STEP, WINDOW_COMMANDS } from "./window-commands";
import { newWindow } from "./windows";
import { heldWindows, noWindowManager, takeWm, type WindowManagerHost } from "./wm-host";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");

function ctx(wm: WindowManagerHost = noWindowManager()) {
  const store = new Store(sampleState("en", epoch));
  return {
    store,
    runtime: { shortcuts: { focused: null }, focusSurface() {}, plugins: {} } as never,
    bridge: undefined as never,
    now: () => 1000,
    wall: () => epoch + 1000,
    tr: (key: string) => key,
    wm,
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

  it("go to the window manager, named for the window in use, and move nothing here", () => {
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
  });

  it("without a window manager (the runtime's own tests and pages) move no window", () => {
    const c = ctx();
    const id = newWindow(c);
    const before = rectOf(c, id);
    for (const run of commands(c).values()) run();
    expect(rectOf(c, id)).toEqual(before);
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
