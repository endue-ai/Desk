// @vitest-environment jsdom
// Compositor mode's window manager seam (#80, ADR 0153): the page tells desk-wm what a press lands
// on and forwards the window commands after sending what changed of the desk; it takes desk-wm's
// changes as the truth and says in its next report which it took and where it lays a held window
// out; a card's button runs one of the frames' own commands, and nothing else.
import { describe, expect, it, vi } from "vitest";
import { type DeskReport, startCompositorDesk } from "./compositor-desk";
import { cardCommand, wmSeam } from "./compositor-wm";

describe("the window manager's seam", () => {
  it("sends a press's grab and a window command, the desk sent before each", () => {
    const sent: [string, unknown][] = [];
    const seam = wmSeam((command, args) => sent.push([command, args]));
    let seq = 0;
    seam.flushWith(() => {
      sent.push(["compositor_desk", {}]);
      return ++seq;
    });
    seam.host.grab({ kind: "resize", window: "window-1", grip: "se" }, { x: 10, y: 20 });
    seam.host.run({ op: "snap", fill: "left" }, "window-1");
    seam.host.run({ op: "maximize" });
    // Each call names the desk it follows, which the shell waits for.
    expect(sent).toEqual([
      ["compositor_desk", {}],
      [
        "compositor_grab",
        { gesture: { kind: "resize", window: "window-1", grip: "se" }, x: 10, y: 20, after: 1 },
      ],
      ["compositor_desk", {}],
      ["compositor_wm", { op: { op: "snap", fill: "left" }, window: "window-1", after: 2 }],
      ["compositor_desk", {}],
      ["compositor_wm", { op: { op: "maximize" }, after: 3 }],
    ]);
  });

  it("takes desk-wm's changes and says which it took and where a held window is", () => {
    const seam = wmSeam(() => undefined);
    const desk = { takeWm: vi.fn(), hold: vi.fn() };
    expect(seam.state()).toEqual({ applied: 0 });
    seam.took({ rev: 3, desktop: "1", pan: { x: -10, y: 0 } }, desk);
    seam.took({ rev: 2, desktop: "1" }, desk);
    expect(desk.takeWm).toHaveBeenCalledTimes(2);
    const rect = { x: 1, y: 2, w: 300, h: 200 };
    seam.held({ window: "window-1", rect }, desk);
    expect(seam.state()).toEqual({ applied: 3, held: { window: "window-1", ...rect } });
    expect(desk.hold).toHaveBeenLastCalledWith("window-1", rect);
    seam.held({ window: null }, desk);
    expect(seam.state()).toEqual({ applied: 3 });
    expect(desk.hold).toHaveBeenLastCalledWith(null, undefined);
  });

  it("runs only the frames' own commands from a card's button", () => {
    expect(cardCommand({ command: "desk.frames.reload", args: { plugin: "p" } })).toEqual({
      command: "desk.frames.reload",
      args: { plugin: "p" },
    });
    expect(cardCommand({ command: "desk.files.delete", args: {} })).toBeUndefined();
    expect(cardCommand({ command: 3 })).toBeUndefined();
  });

  it("puts the seam's state in every report and sends at once when flushed", () => {
    const win = window as Window & typeof globalThis;
    win.requestAnimationFrame = () => 1;
    win.cancelAnimationFrame = () => {};
    let state = {
      lang: "en",
      modes: [
        {
          manifest: { id: "base", extends: null },
          desktop: {},
          list: [{ id: "1", name: "1" }],
          desktops: {},
        },
      ],
      desktops: null,
      modeId: "base",
      desktop: "1",
      session: {},
      pan: {},
      focusBy: {},
      adopted: [],
      drawer: [],
      focused: null,
      pane: null,
    };
    const desk = {
      store: { get: () => state },
      runtime: {
        frames: { state: () => undefined, asleep: () => false },
        settings: { get: (_: string, fallback: unknown) => fallback },
      },
    };
    const reports: DeskReport[] = [];
    const seam = wmSeam(() => undefined);
    const report = startCompositorDesk(win, desk as never, (r) => reports.push(r), seam.state);
    expect(report.flush()).toBe(1);
    expect(reports[0]).toMatchObject({ seq: 1, applied: 0 });
    expect(report.flush()).toBe(1);
    expect(reports[0]?.held).toBeUndefined();
    seam.took({ rev: 1, desktop: "1" }, { takeWm: () => undefined });
    state = { ...state, focused: null };
    report.flush();
    expect(reports[1]).toMatchObject({ seq: 2, applied: 1 });
    report();
  });
});
