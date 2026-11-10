import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Budgets, compare, failed, MEASURES, report, withBaselines } from "./budgets";

const OPENING = {
  p50Ms: 17,
  p95Ms: 18,
  frames: 600,
  windowMs: 10000,
  engine: "WebKit (Playwright)",
  platform: "darwin-arm64",
  recorded: "2026-10-28",
  allowedRegression: 0.25,
};

/** budgets.json as committed: the opening baseline, the app's sections without one. */
function budgets(): Budgets {
  return {
    openingFrameTime: structuredClone(OPENING),
    startup: {
      readyMs: null,
      firstFrameMs: null,
      targetMs: 1200,
      platform: null,
      recorded: null,
      allowedRegression: 0.25,
    },
    idleMemory: { rssMb: null, platform: null, recorded: null, allowedRegression: 0.25 },
    inputLatency: {
      paletteP95Ms: null,
      focusP95Ms: null,
      targetMs: 16,
      platform: null,
      recorded: null,
      allowedRegression: 0.25,
    },
  };
}

const measured = {
  startup: { readyMs: 1400, firstFrameMs: 1500, runs: [] },
  idleMemory: { rssMb: 420.5 },
  inputLatency: { paletteP95Ms: 40, focusP95Ms: 20 },
};

describe("budgets", () => {
  it("measures five values in three sections", () => {
    expect(MEASURES.map((m) => `${m.section}.${m.key}`)).toEqual([
      "startup.readyMs",
      "startup.firstFrameMs",
      "idleMemory.rssMb",
      "inputLatency.paletteP95Ms",
      "inputLatency.focusP95Ms",
    ]);
  });

  it("without a baseline it reports and does not fail", () => {
    const verdicts = compare(budgets(), measured);
    expect(verdicts.map((v) => v.status)).toEqual(Array(5).fill("no-baseline"));
    expect(failed(verdicts)).toBe(false);
    expect(report(verdicts)).toMatch(/no baseline/);
  });

  it("passes within allowedRegression and fails past it", () => {
    const committed = withBaselines(budgets(), measured, {
      platform: "linux-x64",
      recorded: "2026-11-03",
    });
    const within = compare(committed, {
      ...measured,
      startup: { readyMs: 1750, firstFrameMs: 1500 },
    });
    expect(within.every((v) => v.status === "ok")).toBe(true);
    expect(within[0]).toMatchObject({ value: 1750, baseline: 1400, limit: 1750 });
    expect(failed(within)).toBe(false);

    const past = compare(committed, { ...measured, idleMemory: { rssMb: 526 } });
    const memory = past.find((v) => v.section === "idleMemory");
    expect(memory).toMatchObject({ status: "over", baseline: 420.5, limit: 525.6 });
    expect(failed(past)).toBe(true);
    expect(report(past)).toMatch(/over/);
  });

  it("prints the RT-16 targets beside the values and never fails on them", () => {
    const committed = withBaselines(budgets(), measured, {
      platform: "linux-x64",
      recorded: "2026-11-03",
    });
    const verdicts = compare(committed, measured);
    expect(verdicts.map((v) => v.target)).toEqual([1200, 1200, null, 16, 16]);
    expect(failed(verdicts)).toBe(false);
    const text = report(verdicts);
    expect(text).toMatch(/1200/);
    expect(text).toMatch(/16/);
  });

  it("a measurement that is missing is reported as missing", () => {
    const verdicts = compare(budgets(), { startup: measured.startup });
    expect(verdicts.find((v) => v.section === "idleMemory")?.status).toBe("missing");
    expect(report(verdicts)).toMatch(/missing/);
  });

  it("withBaselines fills the app's sections and leaves openingFrameTime as it is", () => {
    const before = budgets();
    const after = withBaselines(before, measured, {
      platform: "linux-x64",
      recorded: "2026-11-03",
    });
    expect(after.openingFrameTime).toEqual(OPENING);
    expect(after.startup).toEqual({
      readyMs: 1400,
      firstFrameMs: 1500,
      targetMs: 1200,
      platform: "linux-x64",
      recorded: "2026-11-03",
      allowedRegression: 0.25,
    });
    expect(after.idleMemory?.rssMb).toBe(420.5);
    expect(after.inputLatency?.focusP95Ms).toBe(20);
    // The input is not changed.
    expect(before.startup?.readyMs).toBeNull();
  });

  it("the committed budgets.json keeps the opening baseline and gates nothing until recorded", () => {
    const committed = JSON.parse(
      readFileSync(new URL("../budgets.json", import.meta.url), "utf8"),
    ) as Budgets;
    // Re-recorded on headless Chromium by #48 (ADR 0144); WebKit's was 18.
    expect(committed.openingFrameTime).toMatchObject({
      p95Ms: 16.7,
      engine: "Chromium (Playwright, headless)",
      allowedRegression: 0.25,
    });
    const verdicts = compare(committed, measured);
    expect(verdicts.map((v) => v.status)).toEqual(Array(5).fill("no-baseline"));
    expect(verdicts.map((v) => v.target)).toEqual([1200, 1200, null, 16, 16]);
  });
});
