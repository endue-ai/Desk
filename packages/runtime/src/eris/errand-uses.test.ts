// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrainStep } from "../bridge/types";
import { ManualClock } from "../clock";
import type { RunWatcher } from "../commands";
import type { ShellCtx } from "../shell/context";
import { Store, sampleState } from "../shell/state";
import { Ticker } from "../shell/ticker";
import { DWELL_MS, LEG_MS, mountErrands } from "./errand";
import { GLOW_IN_MS, GLOW_OUT_MS, USE } from "./visiting";

// A command of the desk's own that Eris runs names the window it acts on (ADR 0271): the step
// that announces it does not, so the errand learns it when the core asks the desk to run it. The
// window lights once the spark that carries the command has landed on it (ADR 0275).
const MOVE: BrainStep = {
  kind: "tool",
  callId: "c1",
  command: "desk.windows.move",
  provider: "desk",
  title: "Move a window",
};
const MOVED: BrainStep = { ...MOVE, kind: "tool-result", ok: true };

describe("the window a desk command of Eris's names", () => {
  let shell: HTMLDivElement;
  let store: Store;
  let clock: ManualClock;
  let reduced = false;
  /** What watches the runs the core asks of the desk, while the errands are mounted. */
  let watch: RunWatcher | undefined;
  let ctx: ShellCtx;
  const next = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** Run the clock `ms` on, a frame at a time, and let what waited on each frame go on. */
  const run = async (ms: number) => {
    for (let at = 0; at < ms; at += 16) {
      clock.advance(16);
      await next();
    }
    await next();
  };
  /** Let what waits on nothing but promises go on: an errand is drawn once its line is read. */
  const settle = () => run(0);
  const spark = () => shell.querySelector<HTMLElement>(".errand");
  const lit = () => store.get().erisWindows;
  const asked = (args: unknown, caller = "agent:eris", id = MOVE.command) =>
    watch?.({ id, args, caller });

  beforeEach(() => {
    reduced = false;
    clock = new ManualClock();
    store = new Store(sampleState("en", 0));
    const placed = (id: string) => ({ id, plugin: "", x: 0, y: 0, w: 9, h: 9, pinned: false });
    const front = [
      { id: "w1", rect: { x: 100, y: 300, w: 400, h: 300 }, z: 0 },
      { id: "w2", rect: { x: 800, y: 200, w: 400, h: 200 }, z: 1 },
    ];
    store.set((s) => ({
      wm: { ...s.wm, front, windows: { [s.wm.here]: [placed("w1"), placed("w2")] } },
    }));
    shell = document.createElement("div");
    shell.className = "shell";
    const body = document.createElement("div");
    body.className = "eris-body";
    const box = { left: 600, top: 40, right: 728, bottom: 178, width: 128, height: 138 };
    body.getBoundingClientRect = () => ({ ...box, x: 600, y: 40, toJSON: () => box });
    shell.append(body);
    document.body.append(shell);
    const watchRuns = (watcher: RunWatcher) => {
      watch = watcher;
      return () => {
        watch = undefined;
      };
    };
    ctx = {
      store,
      eris: { say: () => {}, setState: () => {} },
      ticker: new Ticker(clock),
      reduced: () => reduced,
      runtime: { commands: { watchRuns } },
    } as unknown as ShellCtx;
  });

  afterEach(() => shell.remove());

  it("the errand's spark flies on to its middle, and it glows as one she uses once it lands", async () => {
    const errands = mountErrands(() => shell, ctx);
    errands.step(MOVE);
    await settle();
    // The desk has no window of its own: the spark sets out for the place beside her (814, 73).
    await run(160);
    expect(lit()).toEqual([]);
    asked({ window: "w1", x: 40 });
    await settle();
    await run(LEG_MS - 16);
    expect(lit(), "not before the spark is there").toEqual([]);
    await run(32 + GLOW_IN_MS);
    expect(lit()).toEqual([{ id: "w1", glow: USE }]);
    expect(spark()?.style.transform).toContain("translate(300.0px, 450.0px)");
    expect(spark()?.dataset.leg).toBe("there");
    // Its thread leads to the window from where the spark was when it heard.
    const thread = shell.querySelector<SVGSVGElement>(".errand-thread");
    expect(thread?.querySelector("path")?.getAttribute("d")).toMatch(/L8\.0 [\d.]+$/);
    expect(thread?.dataset.leg).toBe("there");

    // The answer is in: the spark stays a moment, flies home on the clock, and the window goes
    // dark after it.
    errands.step(MOVED);
    const home = errands.finish();
    await run(DWELL_MS);
    await run(LEG_MS + 16);
    await home;
    expect(spark()).toBeNull();
    await run(GLOW_OUT_MS + 16);
    expect(lit()).toEqual([]);
  });

  it("takes the window the answer names too, each window once", async () => {
    const errands = mountErrands(() => shell, ctx);
    errands.step(MOVE);
    await settle();
    // No window named: the command acts on the one in use, and says which in its answer.
    const heard = asked({ x: 40 });
    await run(320);
    expect(lit()).toEqual([]);
    heard?.({ window: "w2", x: 40, y: 0 });
    heard?.({ window: "w2", x: 40, y: 0 });
    await settle();
    await run(LEG_MS + GLOW_IN_MS + 16);
    expect(lit()).toEqual([{ id: "w2", glow: USE }]);
    expect(spark()?.style.transform).toContain("translate(1000.0px, 300.0px)");
    // A second window lights at once: the spark stays where it went first.
    asked({ window: "w1" });
    await settle();
    await run(GLOW_IN_MS + 16);
    expect(lit().map((w) => w.id)).toEqual(["w2", "w1"]);
    expect(spark()?.style.transform).toContain("translate(1000.0px, 300.0px)");
    errands.dispose();
  });

  it("is not lit for the person's own run, another command, or a window not on the desk", async () => {
    const errands = mountErrands(() => shell, ctx);
    errands.step(MOVE);
    await settle();
    expect(asked({ window: "w1" }, "desk"), "the person ran it").toBeUndefined();
    expect(asked({ window: "w1" }, "endue.notes"), "a plugin ran it").toBeUndefined();
    expect(asked({ window: "w1" }, "agent:eris", "desk.windows.close")).toBeUndefined();
    asked({ window: "gone" });
    asked({ window: 7 });
    asked(null);
    await settle();
    await run(LEG_MS + 16);
    expect(lit()).toEqual([]);
    expect(spark()?.style.transform).toContain("translate(814.0px, 73.0px)");
    errands.dispose();
    expect(watch, "a desk that goes stops watching").toBeUndefined();
  });

  it("with reduced motion the window lights and the spark stays beside her", async () => {
    reduced = true;
    const errands = mountErrands(() => shell, ctx);
    errands.step(MOVE);
    asked({ window: "w1" });
    await settle();
    await run(32);
    expect(lit()).toEqual([{ id: "w1", glow: USE }]);
    expect(spark()?.style.transform).toContain("translate(814.0px, 73.0px)");
    expect(shell.querySelector(".errand-thread")).toBeNull();
    errands.dispose();
  });
});
