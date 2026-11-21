// The window commands on a window popped out into an OS window of its own (issue 235, ADR 0294),
// over desk-wm as WebAssembly with an OS window the test keeps: move, resize, fill and pin ask the
// host for that OS window, in points, and answer where it is (out: true); a new tab opens the
// plugin's next window out in an OS window of its own; its one tab closes the window; float and a
// move to another desktop say to dock it first; a desk without OS windows says so.
import { describe, expect, it } from "vitest";
import { windowsOf } from "../shell/actions";
import type { OutAsk, OutFrame } from "../wm/host";
import { CLOSE_TAB, FLOAT, MOVE_TO_DESKTOP, NEW_TAB, PIN } from "./control";
import { windowDesk } from "./control-fixtures";
import { FILL, MOVE, RESIZE } from "./frame";
import { defineOutCommands, outIds, POP_OUT } from "./out";

const SCREEN = { x: 0, y: 25, w: 1440, h: 875 };

/** An OS window as the shell keeps one, much simplified: the shell's own rules are its tests'. */
function osWindow() {
  const asks: [string, OutAsk][] = [];
  let frame: OutFrame = { x: 100, y: 100, w: 400, h: 300, pinned: false, screen: SCREEN };
  const ask = (window: string, a: OutAsk): Promise<OutFrame> => {
    asks.push([window, a]);
    if (a.op === "move") {
      frame = { ...frame, x: a.x ?? frame.x + (a.dx ?? 0), y: a.y ?? frame.y + (a.dy ?? 0) };
    } else if (a.op === "resize") {
      frame = { ...frame, w: a.w ?? frame.w + (a.dw ?? 0), h: a.h ?? frame.h + (a.dh ?? 0) };
    } else if (a.op === "fill") {
      const { fill: _, ...rest } = frame;
      frame = a.fill === "none" ? rest : { ...frame, ...SCREEN, fill: a.fill, screen: SCREEN };
    } else if (a.op === "pin") {
      frame = { ...frame, pinned: a.pinned };
    }
    return Promise.resolve(frame);
  };
  return { asks, ask };
}

/** The windows' desk with notes popped out, its OS window kept by the test. */
async function outDesk() {
  const d = await windowDesk();
  defineOutCommands(d.ctx);
  const os = osWindow();
  Object.assign(d.wm, { outWindow: os.ask });
  await d.commands.settled();
  await d.commands.run(POP_OUT, { window: "notes" });
  expect([...outIds(d.store.get())]).toEqual(["notes"]);
  return { ...d, os };
}

describe("window commands on a window out in an OS window", () => {
  it("move, resize, fill and pin its OS window, answering where it is in points", async () => {
    const { commands, os } = await outDesk();
    expect(await commands.run(MOVE, { window: "notes", x: 40, dy: 10 })).toMatchObject({
      window: "notes",
      desktop: "1",
      x: 40,
      y: 110,
      w: 400,
      h: 300,
      state: "normal",
      out: true,
      screen: SCREEN,
    });
    expect(await commands.run(RESIZE, { window: "notes", w: 640, dh: 100 })).toMatchObject({
      w: 640,
      h: 400,
      out: true,
    });
    expect(await commands.run(FILL, { window: "notes", fill: "left" })).toMatchObject({
      state: "snapped",
      fill: "left",
    });
    expect(await commands.run(FILL, { window: "notes", fill: "none" })).toMatchObject({
      state: "normal",
    });
    expect(await commands.run(PIN, { window: "notes", pinned: true })).toMatchObject({
      pinned: true,
      floating: false,
    });
    expect(os.asks).toEqual([
      ["notes", { op: "move", x: 40, dy: 10 }],
      ["notes", { op: "resize", w: 640, dh: 100 }],
      ["notes", { op: "fill", fill: "left" }],
      ["notes", { op: "fill", fill: "none" }],
      ["notes", { op: "pin", pinned: true }],
    ]);
  });

  it("acts on the out window in use when none is named, and checks what it is asked", async () => {
    const { commands, os, wm, store } = await outDesk();
    await wm.edit([{ op: "focus", window: "notes" }]);
    expect(store.get().focused).toBe("notes");
    expect(await commands.run(MOVE, { dx: 5 })).toMatchObject({ window: "notes", x: 105 });
    await expect(commands.run(MOVE, { window: "notes" })).rejects.toThrow(/say where/);
    await expect(commands.run(MOVE, { window: "notes", x: 1, dx: 1 })).rejects.toThrow(/not both/);
    await expect(commands.run(RESIZE, { window: "notes", w: "big" })).rejects.toThrow(/number/);
    await expect(commands.run(FILL, { window: "notes", fill: "middle" })).rejects.toThrow(/one of/);
    expect(os.asks).toHaveLength(1);
  });

  it("opens a new tab as the plugin's next window, out in an OS window of its own", async () => {
    const { commands, ctx, wm, store } = await outDesk();
    const opened: string[] = [];
    const plugins = ctx.runtime.plugins as unknown as Record<string, unknown>;
    plugins.another = (plugin: string) => {
      const key = `${plugin}@2`;
      opened.push(key);
      // The plugin's next window is placed a little later, as its frame says hello.
      setTimeout(() => {
        const at = { id: key, plugin: key, x: 40, y: 40, w: 400, h: 300, pinned: false };
        void wm.edit([{ op: "place", desktop: "1", placement: at }]);
      }, 0);
      return key;
    };
    expect(await commands.run(NEW_TAB, { window: "notes" })).toEqual({
      window: "endue.notes@2",
      tab: "p1",
      out: true,
    });
    expect(opened).toEqual(["endue.notes@2"]);
    expect([...outIds(store.get())].sort()).toEqual(["endue.notes@2", "notes"]);
    expect(windowsOf(store.get()).map((p) => p.id)).not.toContain("endue.notes@2");
  });

  it("closes its one tab by closing the window, and refuses a tab it does not have", async () => {
    const { commands, store } = await outDesk();
    await expect(commands.run(CLOSE_TAB, { window: "notes", tab: "p9" })).rejects.toThrow(
      /no such tab/,
    );
    expect(await commands.run(CLOSE_TAB, { window: "notes", tab: "p1" })).toEqual({
      window: "notes",
      tab: "p1",
      closed: true,
      windowClosed: true,
    });
    expect(outIds(store.get()).size).toBe(0);
  });

  it("says to dock it first for what only the canvas does", async () => {
    const { commands } = await outDesk();
    await expect(commands.run(FLOAT, { window: "notes", floating: true })).rejects.toThrow(
      /desk\.windows\.dock/,
    );
    await expect(commands.run(MOVE_TO_DESKTOP, { window: "notes", desktop: 2 })).rejects.toThrow(
      /desk\.windows\.dock/,
    );
  });

  it("says so on a desk that has no OS windows", async () => {
    const { commands, ctx } = await windowDesk();
    defineOutCommands(ctx);
    await commands.settled();
    await commands.run(POP_OUT, { window: "notes" });
    await expect(commands.run(MOVE, { window: "notes", x: 1 })).rejects.toThrow(/no OS windows/);
  });
});
