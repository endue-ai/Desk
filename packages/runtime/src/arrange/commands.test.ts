import { BridgeClient, type BridgeEvent, browserStub, stubCommands } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { Commands } from "../commands";
import type { DesktopId, DesktopLayout, SurfacePlacement } from "../modes/types";
import { type Ctx, layoutOf, moveSurface, setDesktop, windowsOf } from "../shell/actions";
import { Store, sampleState } from "../shell/state";
import { Arranger } from "./arranger";
import { CASCADE, defineArrangeCommands, RESTORE, SPREAD, TILE } from "./commands";
import { arrangeArea, cascadeRects, tileRects } from "./geometry";

const ALL = { permission: "cmd:invoke" as const, ids: ["*"] };
const epoch = Date.parse("2026-11-07T09:00:00.000Z");
const AREA = arrangeArea(1440, 900);

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
const desktop = (surfaces: SurfacePlacement[]): DesktopLayout => ({
  surfaces,
  eris: null,
  rail: { visible: true },
  drawer: { visible: true },
});

/** The desk's command registry on the bridge stub's core, which keeps the undo stack (ADR 0077). */
function desk() {
  const registry = stubCommands((event: BridgeEvent) => stub.emit(event));
  const stub = browserStub({ ...registry.handlers });
  const client = new BridgeClient(stub);
  const commands = new Commands(client);
  const store = new Store(sampleState("en", epoch));
  store.set({
    session: {
      1: desktop([
        at("calendar", 10, 20, { fill: "left", restore: { x: 1, y: 2, w: 300, h: 200 } }),
        at("notes", 300, 200),
        at("reference", 50, 60, { floating: true }),
        at("pinned", 900, 500, { pinned: true }),
      ]),
      2: desktop([at("tomorrow", 700, 300), at("keys", 20, 30)]),
    },
    // A plugin window no layout places, in its slot: arranging places it.
    adopted: [{ id: "p.counter", title: "Counter", slot: 0 }],
    focused: "calendar",
  });
  const ctx = {
    store,
    runtime: { commands, shortcuts: { focused: null }, focusSurface() {} },
    bridge: undefined,
    now: () => 0,
    wall: () => epoch,
  } as unknown as Ctx;
  const arranger = new Arranger(ctx, { size: () => ({ vw: 1440, vh: 900 }), gap: () => 12 });
  const spread = { toggle: vi.fn() };
  defineArrangeCommands(ctx, arranger, spread);
  return { store, commands, client, arranger, spread, ctx };
}

const rects = (store: Store, d?: DesktopId) =>
  Object.fromEntries(
    windowsOf(store.get(), d).map((p) => [
      p.id,
      { x: p.x, y: p.y, w: p.w, h: p.h, fill: p.fill, restore: p.restore },
    ]),
  );
const box = (r: { x: number; y: number; w: number; h: number }) => ({ ...r, fill: undefined });

describe("desk.windows.tile and desk.windows.cascade", () => {
  it("register as undoable, with desk.windows.restore-arrangement as their undo", async () => {
    const { commands, client } = desk();
    await commands.settled();
    const { commands: listed } = await client.call("cmd.list", { scope: ALL });
    const undo = Object.fromEntries(listed.map((c) => [c.id, c.undo]));
    expect(undo[TILE]).toBe(RESTORE);
    expect(undo[CASCADE]).toBe(RESTORE);
    expect(undo[RESTORE]).toBeUndefined();
    expect(listed.map((c) => c.id)).toContain(SPREAD);
  });

  it("tile only the normal windows on the current desktop; floating and pinned ones stay", async () => {
    const { store, commands } = desk();
    await commands.settled();
    const before = rects(store);
    const other = rects(store, "2");
    const done = await commands.run(TILE);
    const grid = tileRects(3, AREA, 12);
    const now = rects(store);
    expect(now.calendar).toEqual(box(grid[0] ?? AREA));
    expect(now.notes).toEqual(box(grid[1] ?? AREA));
    expect(now["p.counter"]).toEqual(box(grid[2] ?? AREA));
    expect(now.reference).toEqual(before.reference);
    expect(now.pinned).toEqual(before.pinned);
    // Desktop 2's own windows stay; the plugin window, placed on desktop 1 by the tile, now lives
    // there and leaves the others (ADR 0117).
    expect(rects(store, "2")).toEqual({ tomorrow: other.tomorrow, keys: other.keys });
    expect(other["p.counter"]).toBeDefined();
    // The plugin window entered the layout where it was tiled; the floating one is still floating.
    const layout = layoutOf(store.get());
    expect(layout.surfaces.map((p) => p.id)).toContain("p.counter");
    expect(layout.surfaces.find((p) => p.id === "reference")?.floating).toBe(true);
    expect(done).toMatchObject({ desktop: "1", kind: "tile" });
  });

  it("cascade the same size from the top left, the focused window last and on top", async () => {
    const { store, commands } = desk();
    await commands.settled();
    await commands.run(CASCADE);
    const steps = cascadeRects(3, AREA);
    const now = rects(store);
    expect(now.notes).toEqual(box(steps[0] ?? AREA));
    expect(now["p.counter"]).toEqual(box(steps[1] ?? AREA));
    expect(now.calendar).toEqual(box(steps[2] ?? AREA));
    // Desk order is the stacking order: the cascade's order, whichever window is focused next.
    const order = windowsOf(store.get())
      .filter((p) => !p.floating && !p.pinned)
      .map((p) => p.id);
    expect(order).toEqual(["notes", "p.counter", "calendar"]);
  });

  it("refuse a desktop with no normal window, and leave nothing to undo", async () => {
    const { store, commands, client } = desk();
    store.set({ desktop: 3, adopted: [] });
    await commands.settled();
    await expect(commands.run(TILE)).rejects.toThrow(/No normal window/);
    expect(await client.call("cmd.undo", { scope: ALL })).toEqual({});
  });
});

describe("undo and restore", () => {
  it("cmd.undo puts the previous geometry back as one step, and cmd.redo tiles again", async () => {
    const { store, commands, client } = desk();
    await commands.settled();
    const session = structuredClone(store.get().session);
    const before = rects(store);
    await commands.run(TILE);
    expect(rects(store)).not.toEqual(before);
    const undone = await client.call("cmd.undo", { scope: ALL });
    expect(undone.undone).toMatchObject({ command: TILE, inverse: RESTORE });
    await vi.waitFor(() => expect(rects(store)).toEqual(before));
    // Nothing else changed in between: the desktop is exactly as it was, unsaved edits included.
    expect(store.get().session).toEqual(session);
    await client.call("cmd.redo", { scope: ALL });
    await vi.waitFor(() =>
      expect(rects(store).notes).toEqual(box(tileRects(3, AREA, 12)[1] ?? AREA)),
    );
  });

  it("restore after a later move puts back each arranged window's geometry and keeps the rest", async () => {
    const { store, commands, ctx } = desk();
    await commands.settled();
    const before = rects(store);
    await commands.run(TILE);
    moveSurface(ctx, "reference", { x: 77, y: 88 });
    await commands.run(RESTORE);
    const now = rects(store);
    for (const id of ["calendar", "notes", "p.counter", "pinned"])
      expect(now[id]).toEqual(before[id]);
    expect(now.reference).toMatchObject({ x: 77, y: 88 });
  });

  it("works per desktop, after switching desktops", async () => {
    const { store, commands, ctx, arranger } = desk();
    await commands.settled();
    const one = rects(store, "1");
    await commands.run(TILE);
    const tiledOne = rects(store, "1");
    // Desktop 2 as the tile on desktop 1 left it: the plugin window it placed lives on desktop 1.
    const two = rects(store, "2");
    setDesktop(ctx, "2");
    expect(arranger.canRestore()).toBe(false);
    await commands.run(CASCADE);
    expect(rects(store, "2")).not.toEqual(two);
    await commands.run(RESTORE);
    expect(rects(store, "2")).toEqual(two);
    expect(rects(store, "1")).toEqual(tiledOne);
    await expect(commands.run(RESTORE)).rejects.toThrow(/No earlier layout/);
    setDesktop(ctx, "1");
    expect(arranger.canRestore()).toBe(true);
    await commands.run(RESTORE);
    expect(rects(store, "1")).toEqual(one);
  });

  it("an undo of an arrangement already restored does nothing", async () => {
    const { store, commands, client, ctx } = desk();
    await commands.settled();
    const before = rects(store);
    await commands.run(TILE);
    await commands.run(RESTORE);
    moveSurface(ctx, "notes", { x: 5, y: 6 });
    await client.call("cmd.undo", { scope: ALL });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rects(store).notes).toMatchObject({ x: 5, y: 6 });
    expect(rects(store).calendar).toEqual(before.calendar);
  });
});

describe("desk.windows.spread", () => {
  it("toggles the spread overlay", async () => {
    const { commands, spread } = desk();
    await commands.settled();
    await commands.run(SPREAD);
    expect(spread.toggle).toHaveBeenCalledTimes(1);
  });
});
