// desk.windows.pop-out and desk.windows.dock (issue 235) on the bridge stub's core over desk-wm as
// WebAssembly: a window of one plugin leaves the canvas and comes back to its place, the window in
// use when none is named; a split window, one on another desktop and a dock of a window not out
// are refused with the desk's words.
import { BridgeClient, browserStub, stubCommands } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { Commands } from "../commands";
import type { DesktopId, SurfacePlacement } from "../modes/types";
import { type Ctx, windowsOf } from "../shell/actions";
import { Store, sampleState } from "../shell/state";
import { testWindowManager } from "../wm/testing";
import type { Edit } from "../wm/types";
import { takeDesk } from "../wm/view";
import { CLOSE, defineArrangeCommands } from "./commands";
import { DOCK, defineOutCommands, outIds, POP_OUT, poppable } from "./out";

const epoch = Date.parse("2026-11-14T09:00:00.000Z");

const at = (id: string, x: number, y: number, more: Partial<SurfacePlacement> = {}) => ({
  id,
  plugin: `endue.${id}`,
  x,
  y,
  w: 400,
  h: 300,
  pinned: false,
  ...more,
});
const place = (desktop: DesktopId, placement: SurfacePlacement): Edit => ({
  op: "place",
  desktop,
  placement,
});

async function desk() {
  const registry = stubCommands((event) => stub.emit(event));
  const stub = browserStub({ ...registry.handlers });
  const commands = new Commands(new BridgeClient(stub));
  const store = new Store(sampleState("en", epoch));
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  const split = {
    kind: "split" as const,
    id: "s1",
    dir: "row" as const,
    ratio: 0.5,
    a: { kind: "view" as const, id: "p1", view: "notes" },
    b: { kind: "view" as const, id: "p2", view: "plugin:endue.mail" },
  };
  await wm.edit([
    place("1", at("notes", 300, 200)),
    place("1", at("split", 800, 200, { panes: split })),
    place("2", at("tomorrow", 700, 300)),
    { op: "focus", window: "notes" },
  ]);
  const asked: string[] = [];
  const mayGo = (why: string, what: { plugins: string[] }) => {
    asked.push(`${why} ${what.plugins.join(",")}`);
    return Promise.resolve(true);
  };
  // What each plugin kept before its window moved, and whether the window was out by then.
  const kept: string[] = [];
  const keep = (plugin: string) => {
    const out = [...outIds(store.get())].length > 0;
    kept.push(`${plugin} ${out ? "out" : "on the canvas"}`);
    return Promise.resolve();
  };
  const runtime = { commands, buffers: { mayGo }, shortcuts: { focused: null }, plugins: { keep } };
  const ctx = { store, wm, runtime } as unknown as Ctx;
  defineOutCommands(ctx);
  defineArrangeCommands(ctx);
  await commands.settled();
  return { store, commands, asked, kept };
}

const here = (store: Store) => windowsOf(store.get()).map((p) => p.id);

describe("desk.windows.pop-out and desk.windows.dock", () => {
  it("take a window of one plugin off the canvas and back to its place", async () => {
    const { commands, store, kept } = await desk();
    expect(poppable(store.get(), "notes")).toBe(true);
    expect(await commands.run(POP_OUT, {})).toEqual({ window: "notes" });
    expect(here(store)).not.toContain("notes");
    expect([...outIds(store.get())]).toEqual(["notes"]);
    const out = store.get().wm.layouts["1"]?.surfaces.find((p) => p.id === "notes");
    expect(out?.out).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(await commands.run(DOCK, { window: "notes" })).toEqual({ window: "notes" });
    expect(here(store)).toContain("notes");
    const back = windowsOf(store.get()).find((p) => p.id === "notes");
    expect([back?.x, back?.y, back?.out]).toEqual([300, 200, undefined]);
    expect(store.get().focused).toBe("notes");
    // Its page loads again each time: the plugin kept its state first, before the window moved.
    expect(kept).toEqual(["endue.notes on the canvas", "endue.notes out"]);
  });

  it("refuse a split window, one on another desktop and a dock of one not out", async () => {
    const { commands, store } = await desk();
    expect(poppable(store.get(), "split")).toBe(false);
    await expect(commands.run(POP_OUT, { window: "split" })).rejects.toThrow(/one plugin/);
    await expect(commands.run(POP_OUT, { window: "tomorrow" })).rejects.toThrow(
      /not on this desktop/,
    );
    await expect(commands.run(DOCK, { window: "notes" })).rejects.toThrow(/not popped out/);
    await expect(commands.run(DOCK, {})).rejects.toThrow(/say which/);
    expect(outIds(store.get()).size).toBe(0);
  });

  it("closes a window out of the canvas as desk.windows.close closes any, asking first", async () => {
    const { commands, store, asked } = await desk();
    await commands.run(POP_OUT, { window: "notes" });
    expect(await commands.run(CLOSE, { window: "notes" })).toEqual({
      window: "notes",
      closed: true,
    });
    expect(asked).toEqual(["close endue.notes"]);
    expect(outIds(store.get()).size).toBe(0);
    expect(here(store)).not.toContain("notes");
  });
});
