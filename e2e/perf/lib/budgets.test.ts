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
    freshDeskAtRest: { cpuPercent: null, budgetPercent: 5, platform: null, recorded: null },
    deskOutOfSight: {
      cpuPercent: null,
      budgetPercent: 5,
      turnsPerSecond: null,
      turnsBudget: 50,
      shownFrameMs: null,
      shownBudgetMs: 500,
      platform: null,
      recorded: null,
    },
  };
}

const measured = {
  startup: { readyMs: 1400, firstFrameMs: 1500, runs: [] },
  idleMemory: { rssMb: 420.5 },
  inputLatency: { paletteP95Ms: 40, focusP95Ms: 20 },
  freshDeskAtRest: { cpuPercent: 2.4, treePercent: 6.1 },
  deskOutOfSight: { cpuPercent: 0.8, turnsPerSecond: 21, shownFrameMs: 40 },
};

/** The budgets' verdicts: the five without a baseline, then the four the budgets gate. */
const FIRST_RUN = [...Array(5).fill("no-baseline"), ...Array(4).fill("ok")];
/** The RT-16 targets, by measure. */
const TARGETS = [1200, 1200, null, 16, 16, null, null, null, null];

describe("budgets", () => {
  it("measures nine values in five sections", () => {
    expect(MEASURES.map((m) => `${m.section}.${m.key}`)).toEqual([
      "startup.readyMs",
      "startup.firstFrameMs",
      "idleMemory.rssMb",
      "inputLatency.paletteP95Ms",
      "inputLatency.focusP95Ms",
      "freshDeskAtRest.cpuPercent",
      "deskOutOfSight.cpuPercent",
      "deskOutOfSight.turnsPerSecond",
      "deskOutOfSight.shownFrameMs",
    ]);
  });

  it("without a baseline it reports and does not fail; a budget gates from the first run", () => {
    const verdicts = compare(budgets(), measured);
    expect(verdicts.map((v) => v.status)).toEqual(FIRST_RUN);
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
    expect(verdicts.map((v) => v.target)).toEqual(TARGETS);
    expect(failed(verdicts)).toBe(false);
    const text = report(verdicts);
    expect(text).toMatch(/1200/);
    expect(text).toMatch(/16/);
  });

  it("fails a fresh desk at rest past its CPU budget, whatever a recorded baseline says (#134)", () => {
    const busy = { ...measured, freshDeskAtRest: { cpuPercent: 55.2 } };
    const verdict = compare(budgets(), busy).find((v) => v.section === "freshDeskAtRest");
    expect(verdict).toMatchObject({ status: "over", value: 55.2, limit: 5, baseline: null });
    const recorded = withBaselines(budgets(), busy, { platform: "darwin-arm64", recorded: "x" });
    expect(failed(compare(recorded, busy))).toBe(true);
    expect(report(compare(budgets(), busy))).toMatch(/fresh desk at rest.*55.2 %.*over/);
  });

  it("fails a desk out of sight that spins, whatever a recorded baseline says (#155)", () => {
    const spinning = {
      ...measured,
      deskOutOfSight: { cpuPercent: 99.6, turnsPerSecond: 14_200, shownFrameMs: 40 },
    };
    const verdicts = compare(budgets(), spinning).filter((v) => v.section === "deskOutOfSight");
    expect(verdicts.map((v) => [v.key, v.status, v.limit])).toEqual([
      ["cpuPercent", "over", 5],
      ["turnsPerSecond", "over", 50],
      ["shownFrameMs", "ok", 500],
    ]);
    const recorded = withBaselines(budgets(), spinning, {
      platform: "darwin-arm64",
      recorded: "x",
    });
    expect(failed(compare(recorded, spinning))).toBe(true);
    expect(report(verdicts)).toMatch(/out of sight, its event loop's turns.*14200.0 \/s.*over/);
    const late = { ...measured, deskOutOfSight: { ...measured.deskOutOfSight, shownFrameMs: 900 } };
    expect(compare(budgets(), late).find((v) => v.key === "shownFrameMs")?.status).toBe("over");
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

  it("the committed budgets.json keeps the opening baseline and gates only the budgets until recorded", () => {
    const committed = JSON.parse(
      readFileSync(new URL("../budgets.json", import.meta.url), "utf8"),
    ) as Budgets;
    // Re-recorded on headless Chromium by #48 (ADR 0144); WebKit's was 18.
    expect(committed.openingFrameTime).toMatchObject({
      p95Ms: 16.7,
      engine: "Chromium (Playwright, headless)",
      allowedRegression: 0.25,
    });
    expect(committed.freshDeskAtRest).toMatchObject({ budgetPercent: 5 });
    expect(committed.deskOutOfSight).toMatchObject({
      budgetPercent: 5,
      turnsBudget: 50,
      shownBudgetMs: 500,
    });
    const verdicts = compare(committed, measured);
    expect(verdicts.map((v) => v.status)).toEqual(FIRST_RUN);
    expect(verdicts.map((v) => v.target)).toEqual(TARGETS);
  });
});
