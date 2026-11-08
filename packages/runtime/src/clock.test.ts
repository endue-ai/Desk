import { describe, expect, it } from "vitest";
import { ManualClock, tween } from "./clock";

describe("ManualClock", () => {
  it("runs frame callbacks with the current time when advanced", () => {
    const clock = new ManualClock();
    const times: number[] = [];
    clock.requestFrame((now) => times.push(now));
    expect(times).toEqual([]);
    clock.advance(16);
    clock.advance(16);
    expect(times).toEqual([16]);
    expect(clock.now()).toBe(32);
  });

  it("never runs cancelled frames", () => {
    const clock = new ManualClock();
    let ran = false;
    const cancel = clock.requestFrame(() => {
      ran = true;
    });
    cancel();
    clock.advance(100);
    expect(ran).toBe(false);
  });
});

describe("tween", () => {
  it("interpolates over the duration on the injected clock, then resolves", async () => {
    const clock = new ManualClock();
    const values: number[] = [];
    const done = tween(clock, { from: 0, to: 1, durationMs: 200 }, (v) => values.push(v));
    clock.advance(50);
    clock.advance(50);
    clock.advance(200);
    await done;
    expect(values).toEqual([0, 0.25, 0.5, 1]);
  });
});
