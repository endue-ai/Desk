import { describe, expect, it } from "vitest";
import { compare } from "./budgets";
import { merge, results } from "./results";

describe("results.json", () => {
  it("merges the spec files' sections and passes over what is not one", () => {
    const measured = merge([
      { startup: { readyMs: 900 } },
      null,
      { idleMemory: { rssMb: 400 }, note: "text" },
      { inputLatency: { paletteP95Ms: 30, focusP95Ms: 20 } },
    ]);
    expect(measured).toEqual({
      startup: { readyMs: 900 },
      idleMemory: { rssMb: 400 },
      inputLatency: { paletteP95Ms: 30, focusP95Ms: 20 },
    });
  });

  it("holds the measurements, a verdict per value and whether the run failed", () => {
    const measured = { startup: { readyMs: 900, firstFrameMs: 1000 } };
    const budgets = { startup: { readyMs: 800, firstFrameMs: null, allowedRegression: 0.25 } };
    const out = results(measured, compare(budgets, measured), {
      date: "2026-11-03T02:41:00.000Z",
      platform: "linux-x64",
      commit: "abc1234",
    });
    expect(out).toMatchObject({
      version: 1,
      platform: "linux-x64",
      commit: "abc1234",
      measured,
      failed: false,
    });
    expect(out.verdicts.slice(0, 2)).toEqual([
      {
        name: "startup.readyMs",
        unit: "ms",
        value: 900,
        baseline: 800,
        limit: 1000,
        target: null,
        status: "ok",
      },
      {
        name: "startup.firstFrameMs",
        unit: "ms",
        value: 1000,
        baseline: null,
        limit: null,
        target: null,
        status: "no-baseline",
      },
    ]);
    expect(out.verdicts[2]?.status).toBe("missing");
  });
});
