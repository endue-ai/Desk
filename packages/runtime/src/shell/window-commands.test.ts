// The window commands (desk.display.*, ADR 0153): maximize, the eight snaps and moving and resizing
// by a step act on the window in use, through the window manager (crates/desk-wm, whose
// tests/interactions/wm.rs runs them and tests/fill.rs checks what they do; the runtime runs none
// itself, #83). The desk it publishes back is the runtime's whole (`takeDesk`), and the page lays a
// held window out where the gesture holds it (`heldWindows`).
import { describe, expect, it, vi } from "vitest";
import { heldWindows } from "../wm/host";
import type { LocalWindowManager } from "../wm/local";
import { testWindowManager } from "../wm/testing";
import type { Published } from "../wm/types";
import { takeDesk } from "../wm/view";
import { windowsOf } from "./actions";
import type { ShellCtx } from "./context";
import { Store, sampleState } from "./state";
import { defineWindowCommands, STEP, WINDOW_COMMANDS } from "./window-commands";
import { newWindow } from "./windows";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");

/** The shell over desk-wm; every desk desk-wm publishes is also kept in `published`. */
function ctx(wm: LocalWindowManager = testWindowManager()) {
  const store = new Store(sampleState("en", epoch));
  const published: Published[] = [];
  wm.connect((p) => {
    published.push(p);
    takeDesk(store, p);
  });
  const c = {
    store,
    runtime: { shortcuts: { focused: null }, focusSurface() {}, plugins: {} } as never,
    bridge: undefined as never,
    now: () => 1000,
    wall: () => epoch + 1000,
    tr: (key: string) => key,
    wm,
  } as unknown as ShellCtx;
  return { c, wm, published };
}

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

  it("go to the window manager, named for the window in use", async () => {
    const { c, wm } = ctx();
    const run = vi.spyOn(wm, "run");
    const id = await newWindow(c);
    const all = commands(c);
    all.get("snap-top-left")?.();
    all.get("maximize")?.();
    all.get("move-left")?.();
    expect(run.mock.calls).toEqual([
      [{ op: "snap", fill: "top-left" }, id],
      [{ op: "maximize" }, id],
      [{ op: "move", dx: -STEP, dy: 0 }, id],
    ]);
  });

  it("come back as the desk desk-wm publishes", async () => {
    const { c } = ctx();
    const id = await newWindow(c);
    commands(c).get("maximize")?.();
    expect(windowsOf(c.store.get()).find((p) => p.id === id)).toMatchObject({
      x: 0,
      y: 0,
      w: 1440,
      h: 900,
      fill: "full",
    });
  });

  it("do nothing without a window in use", () => {
    const { c, wm } = ctx();
    const run = vi.spyOn(wm, "run");
    commands(c).get("maximize")?.();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("the host's changes", () => {
  it("are the runtime's whole, and an older desk arriving late is not", async () => {
    const { c, wm, published } = ctx();
    const id = await newWindow(c);
    await wm.edit([{ op: "pan", to: { x: -90, y: 40 } }]);
    const now = c.store.get();
    expect(now.rev).toBe(published.at(-1)?.rev);
    expect(now.pan["1"]).toEqual({ x: -90, y: 40 });
    expect(now.focused).toBe(id);
    // The desk before the pan, delivered late: the store keeps the newer one.
    const late = published.at(-2);
    if (!late) throw new Error("nothing published");
    takeDesk(c.store, late);
    expect(c.store.get()).toBe(now);
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
