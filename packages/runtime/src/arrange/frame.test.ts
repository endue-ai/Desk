// desk.windows.move, resize and fill (ADR 0269) on the bridge stub's core over desk-wm as
// WebAssembly: an agent places a window in CSS pixels in the space desk.windows.list answers, to a
// point and size or by some pixels, maximizes it, snaps it and brings it back from a fill, and
// each command answers where the window ended up. The window manager keeps its own rules (the
// smallest size, the title bar in reach); these tests check the wiring and the answers.
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { windowDesk as desk, drawn, placed } from "./control-fixtures";
import { FILL, MOVE, RESIZE } from "./frame";
import { LATE_MS } from "./target";

describe("the desk a window command made", () => {
  it("is the one answered when the host runs the command after the batch asked next", async () => {
    const { commands, wm } = await desk();
    // The app's shell takes each page call on a thread of its own: the run can come in late.
    const run = wm.run.bind(wm);
    wm.run = (op, window) => void setTimeout(() => run(op, window), 30);
    expect(await commands.run(MOVE, { window: "notes", x: 40, y: 60 })).toMatchObject({
      x: 40,
      y: 60,
    });
  });

  it("is waited for a short while only when the host changes nothing", async () => {
    const { commands, wm } = await desk();
    wm.run = () => undefined;
    const start = performance.now();
    expect(await commands.run(MOVE, { window: "notes", x: 40 })).toMatchObject({ x: 300 });
    expect(performance.now() - start).toBeGreaterThanOrEqual(LATE_MS - 50);
  });
});

describe("desk.windows.move", () => {
  it("puts a window at a point in CSS pixels and answers where it is", async () => {
    const { commands, store } = await desk();
    const frame = await commands.run(MOVE, { window: "notes", x: 120, y: 80 });
    expect(frame).toEqual({
      window: "notes",
      desktop: "1",
      x: 120,
      y: 80,
      w: 400,
      h: 300,
      state: "normal",
      floating: false,
      pinned: false,
    });
    expect(drawn(store, "notes")).toEqual({ x: 120, y: 80, w: 400, h: 300 });
  });

  it("moves by dx and dy, one axis alone keeps the other, and the window in use when none is named", async () => {
    const { commands, store } = await desk();
    expect(await commands.run(MOVE, { dx: -100, dy: 40 })).toMatchObject({
      window: "notes",
      x: 200,
      y: 240,
    });
    expect(await commands.run(MOVE, { window: "notes", x: 500 })).toMatchObject({ x: 500, y: 240 });
    expect(await commands.run(MOVE, { window: "notes", dy: -40 })).toMatchObject({
      x: 500,
      y: 200,
    });
    expect(drawn(store, "notes")).toEqual({ x: 500, y: 200, w: 400, h: 300 });
  });

  it("keeps a floating window floating where it is put on screen", async () => {
    const { commands } = await desk();
    expect(await commands.run(MOVE, { window: "reference", x: 600, y: 300 })).toMatchObject({
      x: 600,
      y: 300,
      state: "floating",
      floating: true,
    });
  });

  it("takes a snapped window out of its fill where it is moved", async () => {
    const { commands, store } = await desk();
    const frame = await commands.run(MOVE, { window: "calendar", x: 100, y: 120 });
    expect(frame).toMatchObject({ x: 100, y: 120, state: "normal" });
    expect(frame).not.toHaveProperty("fill");
    expect(placed(store, "calendar")?.fill).toBeUndefined();
  });

  it("refuses what it cannot do, with the desk's words", async () => {
    const { commands, store } = await desk();
    await expect(commands.run(MOVE, { window: "notes" })).rejects.toThrow(/say where/);
    await expect(commands.run(MOVE, { window: "notes", x: 1, dx: 1 })).rejects.toThrow(
      /x or dx, not both/,
    );
    await expect(commands.run(MOVE, { window: "notes", x: "left" })).rejects.toThrow(/number/);
    await expect(commands.run(MOVE, { window: "tomorrow", x: 0 })).rejects.toThrow(/on desktop 2/);
    await expect(commands.run(MOVE, { window: "nowhere", x: 0 })).rejects.toThrow(
      /not on this desktop/,
    );
    expect(drawn(store, "notes")).toEqual({ x: 300, y: 200, w: 400, h: 300 });
  });
});

describe("desk.windows.resize", () => {
  it("gives a window a size in CSS pixels, its top left corner staying", async () => {
    const { commands, store } = await desk();
    expect(await commands.run(RESIZE, { window: "notes", w: 640, h: 480 })).toMatchObject({
      x: 300,
      y: 200,
      w: 640,
      h: 480,
    });
    expect(await commands.run(RESIZE, { window: "notes", dw: -40 })).toMatchObject({
      w: 600,
      h: 480,
    });
    expect(drawn(store, "notes")).toEqual({ x: 300, y: 200, w: 600, h: 480 });
  });

  it("answers the size the window manager left it at: never below its smallest", async () => {
    const { commands } = await desk();
    const frame = (await commands.run(RESIZE, { window: "notes", w: 10, h: 10 })) as {
      w: number;
      h: number;
    };
    expect(frame.w).toBeGreaterThan(10);
    expect(frame.h).toBeGreaterThan(10);
  });

  it("refuses no size and both kinds of one", async () => {
    const { commands } = await desk();
    await expect(commands.run(RESIZE, { window: "notes" })).rejects.toThrow(/say how big/);
    await expect(commands.run(RESIZE, { window: "notes", h: 1, dh: 1 })).rejects.toThrow(/h or dh/);
  });
});

describe("desk.windows.fill", () => {
  it("snaps to a half and a quarter, maximizes, and none brings it back where it was", async () => {
    const { commands, store } = await desk();
    expect(await commands.run(FILL, { window: "notes", fill: "right" })).toMatchObject({
      state: "snapped",
      fill: "right",
      floating: true,
    });
    const right = drawn(store, "notes");
    expect(right && right.x + right.w).toBeGreaterThan(1400);
    expect(await commands.run(FILL, { window: "notes", fill: "top-left" })).toMatchObject({
      fill: "top-left",
    });
    expect(await commands.run(FILL, { window: "notes", fill: "full" })).toMatchObject({
      state: "filled",
      fill: "full",
    });
    // Asking again leaves it filled: no toggle.
    expect(await commands.run(FILL, { window: "notes", fill: "full" })).toMatchObject({
      fill: "full",
    });
    expect(await commands.run(FILL, { window: "notes", fill: "none" })).toMatchObject({
      x: 300,
      y: 200,
      w: 400,
      h: 300,
      state: "normal",
      floating: false,
    });
    expect(placed(store, "notes")?.restore).toBeUndefined();
  });

  it("brings a snapped window back to its own place, and leaves one that fills nothing", async () => {
    const { commands } = await desk();
    expect(await commands.run(FILL, { window: "calendar", fill: "none" })).toMatchObject({
      x: 40,
      y: 50,
      w: 500,
      h: 400,
      state: "normal",
    });
    expect(await commands.run(FILL, { window: "reference", fill: "none" })).toMatchObject({
      x: 900,
      y: 100,
      state: "floating",
    });
  });

  it("refuses a part it does not know", async () => {
    const { commands } = await desk();
    await expect(commands.run(FILL, { window: "notes", fill: "middle" })).rejects.toThrow(
      /fill is one of/,
    );
  });
});

describe("agents' tools", () => {
  it("every window command is offered to agents with an args schema that compiles", async () => {
    const { client } = await desk();
    const { tools } = await client.call("cmd.tools", { limit: 200 });
    const ids = [
      "desk.windows.move",
      "desk.windows.resize",
      "desk.windows.fill",
      "desk.windows.float",
      "desk.windows.pin",
      "desk.windows.bring-back",
      "desk.windows.move-to-desktop",
      "desk.windows.new",
      "desk.windows.split",
      "desk.windows.close-pane",
    ];
    const ajv = new Ajv2020({ strict: false });
    for (const id of ids) {
      const tool = tools.find((x) => x.command === id);
      expect(tool, id).toBeDefined();
      expect(tool?.name).toBe(id.replaceAll(".", "_"));
      expect(tool?.argsSchema).toMatchObject({ type: "object" });
      expect(() => ajv.compile(tool?.argsSchema ?? {})).not.toThrow();
      expect(tool?.readOnly).toBeFalsy();
    }
    const move = tools.find((x) => x.command === MOVE);
    const check = ajv.compile(move?.argsSchema ?? {});
    expect(check({ window: "notes", x: 1, y: 2 })).toBe(true);
    expect(check({ window: "notes", left: 1 })).toBe(false);
  });
});
