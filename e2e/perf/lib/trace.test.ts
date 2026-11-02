import { describe, expect, it } from "vitest";
import { FIRST_FRAME, READY_LINE, startedAt, startupTimes } from "./trace";

const events = [
  { name: "process_name", ph: "M", pid: 1, tid: 0, args: { name: "endue Desk" } },
  { name: "core init", cat: "core", ph: "X", ts: 10_000, dur: 30_000, pid: 1, tid: 1 },
  { name: "ready line", cat: "core", ph: "i", s: "p", ts: 905_250, pid: 1, tid: 1 },
  {
    name: "first interactive frame",
    cat: "runtime",
    ph: "X",
    ts: 900_000,
    dur: 33_500,
    pid: 1,
    tid: 2,
  },
];

describe("start-up times from a trace", () => {
  it("reads the ready line and the end of the first interactive frame in ms from process start", () => {
    const trace = { traceEvents: events, otherData: { startedAt: 1_793_000_000_000 } };
    expect(READY_LINE).toBe("ready line");
    expect(FIRST_FRAME).toBe("first interactive frame");
    expect(startupTimes(trace)).toEqual({ readyMs: 905.3, firstFrameMs: 933.5 });
    expect(startedAt(trace)).toBe(1_793_000_000_000);
    // The bare array form of the format is a trace too.
    expect(startupTimes(events)).toEqual({ readyMs: 905.3, firstFrameMs: 933.5 });
    expect(startedAt(events)).toBeUndefined();
  });

  it("refuses a trace without the ready line or the first interactive frame", () => {
    expect(() => startupTimes({ traceEvents: events.slice(0, 2) })).toThrow(/ready line/);
    expect(() => startupTimes({ traceEvents: events.slice(0, 3) })).toThrow(
      /first interactive frame/,
    );
    expect(() => startupTimes({})).toThrow(/trace/);
    expect(() => startupTimes(null)).toThrow(/trace/);
  });
});
