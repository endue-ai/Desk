// desk.windows.tile, cascade and restore-arrangement as the desk's commands (ADR 0116): desk-wm
// arranges and keeps what each arrangement replaced (crates/desk-wm/tests/arrange.rs checks the
// grid, the cascade and every restore). What stays the runtime's is the commands' wiring: each is
// one undoable step on the core's undo stack (ADR 0077), which hands the arrangement's answer back
// to restore-arrangement, and a refusal is the command's error. desk.windows.spread asks the window
// manager's host, whose compositor draws it (#54), and desk.windows.focus is its pick: the window
// comes wholly into sight and takes the keys. The stub checks no args; the core does (#163), so the
// args cmd.undo hands restore-arrangement are checked here against those it declares.
import { BridgeClient, type BridgeEvent, browserStub, stubCommands } from "@endue-ai/bridge";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it, vi } from "vitest";
import { Commands } from "../commands";
import type { DesktopId, SurfacePlacement } from "../modes/types";
import { type Ctx, windowsOf } from "../shell/actions";
import { Store, sampleState } from "../shell/state";
import { testWindowManager } from "../wm/testing";
import type { Edit } from "../wm/types";
import { takeDesk } from "../wm/view";
import { CASCADE, defineArrangeCommands, FOCUS, RESTORE, SPREAD, TILE } from "./commands";

const ALL = { permission: "cmd:invoke" as const, ids: ["*"] };
const epoch = Date.parse("2026-11-07T09:00:00.000Z");

const at = (id: string, x: number, y: number, more: Partial<SurfacePlacement> = {}) => ({
  id,
  plugin: "endue.notes",
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

/** The desk's command registry on the bridge stub's core, which keeps the undo stack, over desk-wm. */
async function desk(keys?: (window: string) => void) {
  const seen: BridgeEvent[] = [];
  const registry = stubCommands((event: BridgeEvent) => {
    seen.push(event);
    stub.emit(event);
  });
  const stub = browserStub({ ...registry.handlers });
  const client = new BridgeClient(stub);
  const commands = new Commands(client);
  const store = new Store(sampleState("en", epoch));
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  await wm.edit([
    place("1", at("calendar", 10, 20, { fill: "left", restore: { x: 1, y: 2, w: 300, h: 200 } })),
    place("1", at("notes", 300, 200)),
    place("1", at("reference", 50, 60, { floating: true })),
    place("1", at("pinned", 900, 500, { pinned: true })),
    place("2", at("tomorrow", 700, 300)),
    place("2", at("keys", 20, 30)),
    // A plugin window no layout places, in its slot: arranging places it.
    { op: "adopt", id: "p.counter", title: "Counter" },
    { op: "focus", window: "calendar" },
  ]);
  const ctx = {
    store,
    wm,
    runtime: { commands, shortcuts: { focused: null }, focusSurface() {} },
    bridge: undefined,
    now: () => 0,
    wall: () => epoch,
  } as unknown as Ctx;
  defineArrangeCommands(ctx, keys);
  await commands.settled();
  return { store, wm, commands, client, ctx, seen };
}

/** The args of the latest cmd.invoked of `id`. */
function invokedArgs(seen: BridgeEvent[], id: string): unknown {
  const invoked = seen.filter((e) => e.event === "cmd.invoked" && e.data.id === id).at(-1);
  if (invoked?.event !== "cmd.invoked") throw new Error(`no cmd.invoked of ${id}`);
  return invoked.data.args;
}

const rects = (store: Store, d?: DesktopId) =>
  Object.fromEntries(
    windowsOf(store.get(), d).map((p) => [
      p.id,
      { x: p.x, y: p.y, w: p.w, h: p.h, fill: p.fill, restore: p.restore },
    ]),
  );

describe("desk.windows.tile and desk.windows.cascade", () => {
  it("register as undoable, with desk.windows.restore-arrangement as their undo", async () => {
    const { client } = await desk();
    const { commands: listed } = await client.call("cmd.list", { scope: ALL });
    const undo = Object.fromEntries(listed.map((c) => [c.id, c.undo]));
    expect(undo[TILE]).toBe(RESTORE);
    expect(undo[CASCADE]).toBe(RESTORE);
    expect(undo[RESTORE]).toBeUndefined();
    // The spread and its pick are no arrangements: nothing to undo.
    expect([undo[SPREAD], undo[FOCUS]]).toEqual([undefined, undefined]);
  });

  it("answer what they replaced, and refuse a desktop with no normal window, leaving nothing to undo", async () => {
    const { commands, client, wm } = await desk();
    expect(await commands.run(TILE)).toMatchObject({ desktop: "1", kind: "tile" });
    await client.call("cmd.undo", { scope: ALL });
    await wm.edit([
      { op: "set-desktop", desktop: 3 },
      { op: "release", id: "p.counter" },
    ]);
    await expect(commands.run(CASCADE)).rejects.toThrow(/No normal window/);
    expect(await client.call("cmd.undo", { scope: ALL })).toEqual({});
  });
});

describe("undo and restore", () => {
  it("cmd.undo puts the previous geometry back as one step, and cmd.redo tiles again", async () => {
    const { store, commands, client } = await desk();
    const session = structuredClone(store.get().session);
    const before = rects(store);
    await commands.run(TILE);
    const tiled = rects(store);
    expect(tiled).not.toEqual(before);
    const undone = await client.call("cmd.undo", { scope: ALL });
    expect(undone.undone).toMatchObject({ command: TILE, inverse: RESTORE });
    await vi.waitFor(() => expect(rects(store)).toEqual(before));
    // Nothing else changed in between: the desktop is exactly as it was, unsaved edits included.
    expect(store.get().session).toEqual(session);
    await client.call("cmd.redo", { scope: ALL });
    await vi.waitFor(() => expect(rects(store)).toEqual(tiled));
  });

  it.each([
    [TILE, "tile"],
    [CASCADE, "cascade"],
  ])(
    "%s: the undo hands restore-arrangement args it declares, as the core checks",
    async (id, kind) => {
      const { store, commands, client, seen } = await desk();
      const { commands: listed } = await client.call("cmd.list", { scope: ALL });
      const schema = listed.find((c) => c.id === RESTORE)?.argsSchema;
      if (!schema) throw new Error(`${RESTORE} declares no args`);
      const fits = new Ajv2020({ strict: true }).compile(schema);
      const before = rects(store);
      await commands.run(id);
      await client.call("cmd.undo", { scope: ALL });
      await vi.waitFor(() => expect(rects(store)).toEqual(before));
      const handed = invokedArgs(seen, RESTORE);
      expect(handed).toMatchObject({ args: {}, result: { desktop: "1", kind } });
      expect(fits(handed), JSON.stringify(fits.errors)).toBe(true);
      // The strip, keys and the palette run it bare; anything else is still refused.
      expect(fits({})).toBe(true);
      expect(fits({ window: "notes" })).toBe(false);
    },
  );

  it("an undo of an arrangement already restored does nothing", async () => {
    const { store, commands, client, wm } = await desk();
    const before = rects(store);
    await commands.run(TILE);
    await commands.run(RESTORE);
    await wm.edit([{ op: "set-geometry", geometry: { id: "notes", x: 5, y: 6, w: 400, h: 300 } }]);
    await client.call("cmd.undo", { scope: ALL });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rects(store).notes).toMatchObject({ x: 5, y: 6 });
    expect(rects(store).calendar).toEqual(before.calendar);
  });

  it("restore with nothing arranged is the command's error", async () => {
    const { commands } = await desk();
    await expect(commands.run(RESTORE)).rejects.toThrow(/No earlier layout/);
  });
});

describe("the spread's commands", () => {
  it("desk.windows.spread asks the window manager's host, whose compositor opens or closes it", async () => {
    const { commands, wm } = await desk();
    const run = vi.spyOn(wm, "run");
    await commands.run(SPREAD);
    expect(run).toHaveBeenCalledWith({ op: "spread" });
  });

  it("desk.windows.focus brings a window wholly into sight and gives it the keys", async () => {
    const keys = vi.fn();
    const { commands, store, wm } = await desk(keys);
    // Panned left, Notes (300, 200, 400 by 300) is out of sight past the app's left edge.
    await wm.edit([{ op: "pan", to: { x: -1200, y: 0 } }]);
    expect(await commands.run(FOCUS, { window: "notes" })).toEqual({ window: "notes" });
    // The canvas came back just far enough: Notes' left edge is on the app's.
    expect(store.get().pan["1"]).toEqual({ x: -300, y: 0 });
    expect(store.get().focused).toBe("notes");
    expect(keys).toHaveBeenCalledWith("notes");
    await expect(commands.run(FOCUS, { window: "tomorrow" })).rejects.toThrow(
      /not on this desktop/,
    );
    await expect(commands.run(FOCUS, {})).rejects.toThrow(/say which/);
  });
});
