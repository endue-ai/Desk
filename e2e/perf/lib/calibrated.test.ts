import { describe, expect, it } from "vitest";
import { type Budget, calibrate, fastest, judge, limitOf, recorded } from "./calibrated";

const BASE: Budget = {
  baseline: 100,
  unit: "ms",
  calibrationMs: 20,
  allowedRegression: 0.5,
  platform: "darwin-arm64",
  recorded: "2026-11-23",
  load: 4.2,
  reason: "a case",
};

describe("a budget judged against the machine's calibration", () => {
  it("a limit grows with the machine's slowness, never shrinks", () => {
    expect(limitOf(BASE, 20)).toBe(150);
    // A faster moment than the record's leaves the limit where it was.
    expect(limitOf(BASE, 10)).toBe(150);
    // Twice as slow a machine: twice the limit.
    expect(limitOf(BASE, 40)).toBe(300);
    // Capped: a machine past the cap's slowness is not given more.
    expect(limitOf(BASE, 2000)).toBe(150 * 6);
    expect(limitOf({ ...BASE, slack: 10 }, 40)).toBe(320);
    expect(limitOf({ ...BASE, baseline: null }, 20)).toBeNull();
  });

  it("a value past its limit fails, one within it passes, one without a baseline is reported", () => {
    expect(judge(BASE, 149, 20, "darwin-arm64")).toMatchObject({ verdict: "pass", limit: 150 });
    expect(judge(BASE, 151, 20, "darwin-arm64")).toMatchObject({ verdict: "fail", limit: 150 });
    expect(judge(BASE, 290, 40, "darwin-arm64")).toMatchObject({ verdict: "pass", scale: 2 });
    expect(judge({ ...BASE, baseline: null }, 5, 20, "darwin-arm64")).toMatchObject({
      verdict: "report",
      limit: null,
    });
  });

  it("a baseline from another platform is reported, never failed", () => {
    expect(judge(BASE, 1000, 20, "linux-x64")).toMatchObject({ verdict: "report" });
  });

  it("record keeps the value with the calibration and the load it was taken at", () => {
    const next = recorded(BASE, 87.26, {
      calibrationMs: 18.04,
      load: 3.14,
      platform: "linux-x64",
      date: "2026-12-01",
    });
    expect(next).toEqual({
      ...BASE,
      baseline: 87.3,
      calibrationMs: 18,
      load: 3.1,
      platform: "linux-x64",
      recorded: "2026-12-01",
    });
    expect(BASE.baseline).toBe(100);
  });

  it("takes the fastest of its runs, and the calibration is a positive time", async () => {
    let n = 0;
    const times = [30, 10, 20];
    let clock = 0;
    const ms = await fastest(
      3,
      async () => {
        clock += times[n++] ?? 0;
      },
      () => clock,
    );
    expect(ms).toBe(10);
    expect(calibrate(2)).toBeGreaterThan(0);
  });
});
