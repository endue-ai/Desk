import { beforeEach, describe, expect, it } from "vitest";
import { FIRST_FRAME, nextPaint, reportStartup, type StartupPhase } from "./startup";

beforeEach(() => performance.clearMeasures());

/** Animation frames run by hand: `frame(at)` calls what was asked for since the last one. */
function frames() {
  let queue: Array<(at: number) => void> = [];
  return {
    request: (callback: (at: number) => void) => {
      queue.push(callback);
      return queue.length;
    },
    frame(at: number) {
      const due = queue;
      queue = [];
      for (const callback of due) callback(at);
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the start-up report to the app's trace", () => {
  it("sends the phases at ready, then again with the first interactive frame once painted", async () => {
    performance.measure("desk:plugin list", { start: 1, end: 3 });
    let paint: (at: number) => void = () => {};
    const painted = new Promise<number>((resolve) => {
      paint = resolve;
    });
    const sent: StartupPhase[][] = [];
    const done = reportStartup({
      tracing: true,
      ready: 100,
      painted,
      send: async (phases) => void sent.push(phases),
    });
    await tick();
    expect(sent).toEqual([[{ name: "plugin list", start: 1, duration: 2 }]]);

    paint(133);
    await done;
    expect(FIRST_FRAME).toBe("first interactive frame");
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual([
      { name: "plugin list", start: 1, duration: 2 },
      { name: FIRST_FRAME, start: 100, duration: 33 },
    ]);
  });

  it("nextPaint resolves with the time of the second animation frame", async () => {
    const raf = frames();
    let at: number | undefined;
    void nextPaint(raf.request).then((time) => {
      at = time;
    });
    raf.frame(16);
    await tick();
    expect(at).toBeUndefined();
    raf.frame(33);
    await tick();
    expect(at).toBe(33);
  });

  it("sends nothing when the trace is off, and a failed send does not throw", async () => {
    const sent: StartupPhase[][] = [];
    await reportStartup({
      tracing: false,
      ready: 0,
      painted: Promise.resolve(16),
      send: async (phases) => void sent.push(phases),
    });
    expect(sent).toEqual([]);
    await expect(
      reportStartup({
        tracing: true,
        ready: 0,
        painted: Promise.resolve(16),
        send: () => Promise.reject(new Error("no app")),
      }),
    ).resolves.toBeUndefined();
  });
});
