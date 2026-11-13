// @vitest-environment jsdom
// The window manager's seam in the app (#80, #83, ADR 0153): the page sends the runtime's edits to
// desk-wm numbered, and a press's grab, a window command and a snapshot each naming the last edit
// they follow; it takes each desk desk-wm publishes whole, settles the edits that desk answers, and
// says in its next report which desk it took and where it lays a held window out; it keeps the live
// set desk-wm's budget sends; a card's button runs one of the frames' own commands, and nothing
// else.
import type { Published } from "@endue-ai/runtime";
import { describe, expect, it, vi } from "vitest";
import { type DeskReport, startCompositorDesk } from "./compositor-desk";
import { cardCommand, wmSeam } from "./compositor-wm";

/** A desk desk-wm published under `rev`, answering batch `seq` with `values` when given. */
function published(rev: number, answered?: { seq: number; values: unknown[] }): Published {
  return { rev, desk: {} as Published["desk"], view: {} as Published["view"], answered };
}

describe("the window manager's seam", () => {
  it("numbers the edits, and a grab, a window command and a snapshot name the last one", () => {
    const sent: [string, unknown][] = [];
    const asked: [string, unknown][] = [];
    const seam = wmSeam(
      (command, args) => sent.push([command, args]),
      <T>(command: string, args: Record<string, unknown>) => {
        asked.push([command, args]);
        return Promise.resolve({ screen: { w: 0, h: 0 }, windows: [] } as T);
      },
    );
    seam.host.grab({ kind: "pan" }, { x: 1, y: 2 });
    void seam.host.edit([{ op: "new-window" }]);
    seam.host.grab({ kind: "resize", window: "window-1", grip: "se" }, { x: 10, y: 20 });
    seam.host.run({ op: "snap", fill: "left" }, "window-1");
    void seam.host.edit([{ op: "split", dir: "row" }, { op: "blur" }]);
    seam.host.run({ op: "maximize" });
    void seam.host.snapshot({ titles: {}, frames: {} });
    // The shell applies the edits in order and holds each call until the edit it follows is in.
    expect(sent).toEqual([
      ["compositor_grab", { gesture: { kind: "pan" }, x: 1, y: 2, after: 0 }],
      ["compositor_edit", { seq: 1, edits: [{ op: "new-window" }] }],
      [
        "compositor_grab",
        { gesture: { kind: "resize", window: "window-1", grip: "se" }, x: 10, y: 20, after: 1 },
      ],
      ["compositor_wm", { op: { op: "snap", fill: "left" }, window: "window-1", after: 1 }],
      ["compositor_edit", { seq: 2, edits: [{ op: "split", dir: "row" }, { op: "blur" }] }],
      ["compositor_wm", { op: { op: "maximize" }, after: 2 }],
    ]);
    expect(asked).toEqual([
      ["compositor_snapshot", { told: { titles: {}, frames: {} }, after: 2 }],
    ]);
  });

  it("takes every desk desk-wm publishes and settles an edit once the desk it made is in", async () => {
    const seam = wmSeam(
      () => undefined,
      () => Promise.reject(new Error("no snapshot here")),
    );
    const take = vi.fn();
    seam.host.connect(take);
    const done = seam.host.edit([{ op: "new-window" }]);
    let settled = false;
    void done.then(() => {
      settled = true;
    });
    seam.took(published(3));
    await Promise.resolve();
    expect(settled).toBe(false);
    // The runtime took the desk before the edit's answer arrives.
    seam.took(published(4, { seq: 1, values: ["window-1"] }));
    await expect(done).resolves.toEqual(["window-1"]);
    expect(take.mock.calls.map(([p]) => (p as Published).rev)).toEqual([3, 4]);
    // An older desk arriving late is still handed over (the runtime drops it); applied stays.
    seam.took(published(2));
    expect(take).toHaveBeenCalledTimes(3);
    expect(seam.state()).toEqual({ applied: 4 });
  });

  it("says where a held window is laid out, and lets it go", () => {
    const seam = wmSeam(
      () => undefined,
      () => Promise.reject(new Error("no snapshot here")),
    );
    const desk = { hold: vi.fn() };
    expect(seam.state()).toEqual({ applied: 0 });
    const rect = { x: 1, y: 2, w: 300, h: 200 };
    seam.held({ window: "window-1", rect }, desk);
    expect(seam.state()).toEqual({ applied: 0, held: { window: "window-1", ...rect } });
    expect(desk.hold).toHaveBeenLastCalledWith("window-1", rect);
    seam.held({ window: null }, desk);
    expect(seam.state()).toEqual({ applied: 0 });
    expect(desk.hold).toHaveBeenLastCalledWith(null, undefined);
  });

  it("keeps the live set desk-wm's budget sends and tells the runtime it changed", () => {
    const seam = wmSeam(
      () => undefined,
      () => Promise.reject(new Error("no snapshot here")),
    );
    // Until the budget decided, every window keeps its frame.
    expect(seam.host.live?.()).toBeUndefined();
    let heard = 0;
    const off = seam.host.onLive?.(() => heard++);
    seam.live(["endue.notes"]);
    expect([...(seam.host.live?.() ?? [])]).toEqual(["endue.notes"]);
    off?.();
    seam.live([]);
    expect(heard).toBe(1);
    expect([...(seam.host.live?.() ?? [])]).toEqual([]);
  });

  it("runs only the frames' own commands from a card's button", () => {
    expect(cardCommand({ command: "desk.frames.reload", args: { plugin: "p" } })).toEqual({
      command: "desk.frames.reload",
      args: { plugin: "p" },
    });
    // The close of an OS window a plugin shows in (#234).
    expect(cardCommand({ command: "desk.windows.close", args: { window: "w" } })).toEqual({
      command: "desk.windows.close",
      args: { window: "w" },
    });
    // An OS window's Move to Desk and a plugin's first pop out (#235).
    for (const command of ["desk.windows.dock", "desk.windows.pop-out"])
      expect(cardCommand({ command, args: { window: "w" } })).toEqual({
        command,
        args: { window: "w" },
      });
    expect(cardCommand({ command: "desk.windows.tile", args: {} })).toBeUndefined();
    expect(cardCommand({ command: "desk.files.delete", args: {} })).toBeUndefined();
    expect(cardCommand({ command: 3 })).toBeUndefined();
  });

  it("puts the seam's state in every report and sends at once when flushed", () => {
    const win = window as Window & typeof globalThis;
    win.requestAnimationFrame = () => 1;
    win.cancelAnimationFrame = () => {};
    const state = { lang: "en", adopted: [], drawer: [], wm: { here: "1", windows: {} } };
    const desk = {
      store: { get: () => state },
      runtime: {
        frames: { state: () => undefined, asleep: () => false },
        settings: { get: (_: string, fallback: unknown) => fallback },
      },
    };
    const reports: DeskReport[] = [];
    const seam = wmSeam(
      () => undefined,
      () => Promise.reject(new Error("no snapshot here")),
    );
    const pages = { list: () => [] };
    const report = startCompositorDesk(
      win,
      desk as never,
      pages,
      (r) => reports.push(r),
      seam.state,
    );
    expect(report.flush()).toBe(1);
    expect(reports[0]).toMatchObject({ seq: 1, applied: 0 });
    // Nothing changed: nothing more is sent.
    expect(report.flush()).toBe(1);
    expect(reports[0]?.held).toBeUndefined();
    seam.took(published(1));
    report.flush();
    expect(reports[1]).toMatchObject({ seq: 2, applied: 1 });
    report();
  });
});
