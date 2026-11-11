// A resting surface's page asks the desk for frames (#134, frame_asks.js): run in a page of its own,
// with its frames, timers and clock played by the test. A page waiting on a frame keeps asking until
// one comes, wherever its frames stopped; an ask that brought none is asked again a second on; a
// page that wants nothing asks for nothing.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("./frame_asks.js", import.meta.url), "utf8");
/** One desk frame, in ms. */
const FRAME = 1000 / 60;

/** A page running the ask script: its frames, timers and clock are the test's. */
function page() {
  let now = 0;
  let frames: Array<(time: number) => void> = [];
  let timers: Array<{ id: number; at: number; run: () => void }> = [];
  let ids = 0;
  const observers: Array<() => void> = [];
  const wakes: number[] = [];
  // What each ask said: how long the page had waited since its first ask for the wants unmet.
  const waited: number[] = [];
  const scope: Record<string, unknown> = {
    __deskNative: {
      wake: (ms: number) => {
        wakes.push(now);
        waited.push(ms);
      },
    },
    requestAnimationFrame: (callback: (time: number) => void) => {
      frames.push(callback);
      ids += 1;
      return ids;
    },
    setTimeout: (run: () => void, ms = 0) => {
      ids += 1;
      timers.push({ id: ids, at: now + Math.max(0, ms), run });
      return ids;
    },
    clearTimeout: (id: number) => {
      timers = timers.filter((t) => t.id !== id);
    },
    performance: { now: () => now },
    addEventListener: () => {},
  };
  class Observer {
    constructor(callback: () => void) {
      observers.push(callback);
    }
    observe() {}
  }
  new Function("globalThis", "document", "MutationObserver", SOURCE)(scope, {}, Observer);
  const raf = scope.requestAnimationFrame as (callback: (time: number) => void) => number;
  /** Time runs `ms` on, its timers firing in order. */
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      timers = timers.filter((t) => t !== next);
      now = Math.max(now, next.at);
      next.run();
    }
    now = end;
  };
  /** A frame: the callbacks asked for before it run; those they ask for wait for the next. */
  const frame = () => {
    const due = frames;
    frames = [];
    for (const callback of due) callback(now);
  };
  /** `count` desk frames, a frame's time apart. */
  const run = (count: number) => {
    for (let i = 0; i < count; i += 1) {
      advance(FRAME);
      frame();
    }
  };
  /** The page animates: each frame asks for the next. */
  const animate = () => {
    const tick = () => raf(tick);
    raf(tick);
  };
  const mutate = () => {
    for (const observer of observers) observer();
  };
  return {
    wakes,
    waited,
    advance,
    frame,
    run,
    animate,
    mutate,
    raf,
    now: () => now,
  };
}

describe("frame_asks.js", () => {
  it("asks within 40 ms once an animating page's frames stop, wherever they stop", () => {
    for (let frames = 1; frames <= 12; frames += 1) {
      const p = page();
      p.animate();
      p.run(frames);
      expect(p.wakes, `frames came on time: ${frames}`).toEqual([]);
      const stopped = p.now();
      p.advance(100);
      const asked = p.wakes.map((at) => at - stopped <= 41);
      expect(asked, `stopped after ${frames} frames, asked ${p.wakes}`).toEqual([true]);
    }
  });

  it("asks again within 40 ms when the frames an ask brought stop, however many there were", () => {
    for (let answered = 1; answered <= 6; answered += 1) {
      const p = page();
      p.animate();
      p.run(4);
      p.advance(100);
      expect(p.wakes.length, "its frames stopped").toBe(1);
      p.run(answered);
      const stopped = p.now();
      p.advance(100);
      const again = p.wakes.slice(1).map((at) => at - stopped <= 41);
      expect(again, `${answered} frames answered the ask, asked ${p.wakes}`).toEqual([true]);
    }
  });

  it("asks again a second on while no frame comes, and stops once one does", () => {
    const p = page();
    p.raf(() => {});
    p.advance(3500);
    expect(p.wakes.length).toBe(4);
    expect(p.wakes[0]).toBeLessThanOrEqual(41);
    const gaps = p.wakes.slice(1).map((at, i) => at - (p.wakes[i] ?? 0));
    expect(
      gaps.every((ms) => ms >= 1000 && ms <= 1041),
      `${gaps}`,
    ).toBe(true);
    p.frame();
    p.advance(5000);
    expect(p.wakes.length, "its frame came").toBe(4);
  });

  it("says how long it has waited since its first ask, until a frame comes (#157)", () => {
    const p = page();
    p.animate();
    p.run(3);
    p.advance(3100);
    expect(p.waited, "a first ask, then each a second on").toEqual([0, 1000, 2000, 3000]);
    p.frame();
    p.run(2);
    p.advance(100);
    expect(p.waited.slice(4), "its frames came, then stopped again: a first ask").toEqual([0]);
  });

  it("asks within 40 ms for a change after an answered ask, not a second on", () => {
    const p = page();
    p.mutate();
    p.advance(50);
    expect(p.wakes).toEqual([40]);
    p.frame();
    p.advance(450);
    p.mutate();
    p.advance(100);
    expect(p.wakes).toEqual([40, 540]);
  });

  it("asks for nothing while frames come, or once the page wants none", () => {
    const p = page();
    p.animate();
    p.run(120);
    expect(p.wakes, "frames came").toEqual([]);
    const still = page();
    still.mutate();
    still.raf(() => {});
    still.run(1);
    still.advance(5000);
    expect(still.wakes, "its one frame came").toEqual([]);
    const idle = page();
    idle.advance(5000);
    expect(idle.wakes, "it wanted none").toEqual([]);
  });
});
