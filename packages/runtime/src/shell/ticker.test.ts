import { describe, expect, it } from "vitest";
import { type Clock, ManualClock } from "../clock";
import { IDLE, Ticker } from "./ticker";

/** A manual clock that counts the frames asked of it. */
function counting(): { clock: ManualClock; asked: () => number } {
  const clock = new ManualClock();
  let asked = 0;
  const requestFrame = clock.requestFrame.bind(clock);
  (clock as Clock).requestFrame = (callback) => {
    asked += 1;
    return requestFrame(callback);
  };
  return { clock, asked: () => asked };
}

describe("the ticker", () => {
  it("asks for no frames once every tick is idle, and runs again when woken or given a new tick", () => {
    const { clock, asked } = counting();
    const ticker = new Ticker(clock);
    let calls = 0;
    ticker.add(() => {
      calls += 1;
      return IDLE;
    });
    clock.advance(16);
    const after = asked();
    clock.advance(16);
    clock.advance(16);
    expect(asked(), "asleep: no frame asked").toBe(after);
    expect(ticker.now(), "the clock's own time while it sleeps").toBe(48);
    const seen = calls;
    ticker.wake();
    clock.advance(16);
    expect(calls, "woken: one more frame").toBe(seen + 1);
    let frames = 0;
    const off = ticker.add(() => {
      frames += 1;
    });
    clock.advance(16);
    clock.advance(16);
    expect(frames, "a tick that returns nothing keeps the loop running").toBe(3);
    off();
    clock.advance(16);
    const resting = asked();
    clock.advance(16);
    expect(asked(), "asleep again once only idle ticks are left").toBe(resting);
  });

  it("a tick that throws keeps the loop running for the others", () => {
    const clock = new ManualClock();
    const ticker = new Ticker(clock);
    let frames = 0;
    ticker.add(() => {
      frames += 1;
      if (frames > 1) throw new Error("broken");
      return IDLE;
    });
    const quiet = console.error;
    console.error = () => {};
    try {
      clock.advance(16);
      clock.advance(16);
      clock.advance(16);
    } finally {
      console.error = quiet;
    }
    expect(frames).toBe(4);
  });
});
