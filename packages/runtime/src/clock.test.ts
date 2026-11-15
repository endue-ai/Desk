import { afterEach, describe, expect, it, vi } from "vitest";
import { type ClockPage, HIDDEN_FRAME_MS, ManualClock, realClock, tween } from "./clock";

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

describe("realClock", () => {
  /** A page with the browser's frames held in `frames`, run by hand; hidden or not as `hide` says. */
  function page() {
    const frames = new Map<number, (now: number) => void>();
    let handle = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => {
      frames.set(++handle, callback);
      return handle;
    });
    vi.stubGlobal("cancelAnimationFrame", (h: number) => frames.delete(h));
    const heard: Array<() => void> = [];
    const doc = {
      hidden: false,
      addEventListener: (_: string, listener: () => void) => heard.push(listener),
    };
    const hide = (hidden: boolean) => {
      doc.hidden = hidden;
      for (const listener of heard) listener();
    };
    return { frames, hide, clock: realClock(doc as unknown as ClockPage) };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs a frame on the browser's animation frame while the page shows", () => {
    vi.useFakeTimers();
    const { frames, clock } = page();
    const times: number[] = [];
    clock.requestFrame((now) => times.push(now));
    vi.advanceTimersByTime(1000);
    expect(times).toEqual([]);
    for (const frame of frames.values()) frame(123);
    expect(times).toEqual([123]);
  });

  it("runs a frame on a timer while the page is hidden, which gets no animation frames", async () => {
    vi.useFakeTimers();
    const { frames, hide, clock } = page();
    hide(true);
    const values: number[] = [];
    const done = tween(clock, { from: 0, to: 1, durationMs: 120 }, (v) => values.push(v));
    expect(frames.size).toBe(0);
    await vi.advanceTimersByTimeAsync(HIDDEN_FRAME_MS * 4);
    await done;
    expect(values.at(-1)).toBe(1);
  });

  it("moves a frame still out to a timer when the page goes out of sight, and runs it once", () => {
    vi.useFakeTimers();
    const { frames, hide, clock } = page();
    let runs = 0;
    clock.requestFrame(() => runs++);
    hide(true);
    expect(frames.size).toBe(0);
    vi.advanceTimersByTime(HIDDEN_FRAME_MS);
    expect(runs).toBe(1);
    // Shown again: the frame that ran is not asked for a second time.
    hide(false);
    vi.advanceTimersByTime(HIDDEN_FRAME_MS);
    expect(frames.size).toBe(0);
    expect(runs).toBe(1);
  });

  it("never runs a cancelled frame, hidden or not", () => {
    vi.useFakeTimers();
    const { frames, hide, clock } = page();
    let ran = false;
    const shown = clock.requestFrame(() => {
      ran = true;
    });
    shown();
    expect(frames.size).toBe(0);
    hide(true);
    clock.requestFrame(() => {
      ran = true;
    })();
    vi.advanceTimersByTime(HIDDEN_FRAME_MS * 2);
    expect(ran).toBe(false);
  });
});
