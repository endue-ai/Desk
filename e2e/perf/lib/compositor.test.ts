import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Budgets, compare, failed, GATES, report, withBaselines } from "./compositor.ts";

/** The compositor sections as committed: the budgets, #35's memory baseline, the starts open. */
function budgets(): Budgets {
  return {
    compose: { budgetMs: 4, p95Ms: null, platform: null, recorded: null },
    composeStartup: { firstComposeMs: null, allowedRegression: 0.25, platform: null },
    surfaceStartup: { firstComposeMs: null, allowedRegression: 0.25, platform: null },
    surfaceMemory: {
      perSurfaceMb: 120.7,
      band: 0.2,
      tool: "footprint",
      platform: "darwin-arm64",
      recorded: "2026-11-10",
    },
    inputToPaint: { p95Ms: null, budgetMs: 16, frameP50Ms: null, frameBudgetMs: 16 },
  };
}

const reference = { platform: "darwin-arm64" };
const measured = {
  compose: {
    p95Ms: 0.48,
    medianMs: 0.41,
    adapter: "Apple M4 Max (Metal)",
    software: false,
    ...reference,
  },
  composeStartup: { firstComposeMs: 180, adapter: "Apple M4 Max (Metal)", ...reference },
  surfaceStartup: { firstComposeMs: 200, slowestMs: 230, ...reference },
  surfaceMemory: { perSurfaceMb: 125, tool: "footprint", ...reference },
  inputToPaint: {
    p95Ms: 8.5,
    p50Ms: 6.3,
    frameP50Ms: 14.8,
    frameP95Ms: 24,
    software: false,
    ...reference,
  },
};

const status = (verdicts: ReturnType<typeof compare>) =>
  Object.fromEntries(verdicts.map((v) => [`${v.section}.${v.key}`, v.status]));

describe("compositor budgets", () => {
  it("gates compose, both starts, memory per surface, and a press to its paint and its frame", () => {
    expect(GATES.map((g) => `${g.section}.${g.key}:${g.kind}`)).toEqual([
      "compose.p95Ms:budget",
      "composeStartup.firstComposeMs:regression",
      "surfaceStartup.firstComposeMs:regression",
      "surfaceStartup.slowestMs:regression",
      "surfaceMemory.perSurfaceMb:band",
      "inputToPaint.p95Ms:budget",
      "inputToPaint.frameP50Ms:budget",
    ]);
  });

  it("passes within the budgets and the band", () => {
    const verdicts = compare(budgets(), measured);
    expect(status(verdicts)).toEqual({
      "compose.p95Ms": "ok",
      "composeStartup.firstComposeMs": "no-baseline",
      "surfaceStartup.firstComposeMs": "no-baseline",
      "surfaceStartup.slowestMs": "no-baseline",
      "surfaceMemory.perSurfaceMb": "ok",
      "inputToPaint.p95Ms": "ok",
      "inputToPaint.frameP50Ms": "ok",
    });
    expect(failed(verdicts)).toBe(false);
    const memory = verdicts.find((v) => v.section === "surfaceMemory");
    expect(memory).toMatchObject({ low: 96.6, high: 144.8 });
  });

  it("fails a compose frame over 4 ms on a GPU and only reports it on a software adapter", () => {
    const slow = { ...measured, compose: { ...measured.compose, p95Ms: 4.2 } };
    expect(status(compare(budgets(), slow))["compose.p95Ms"]).toBe("over");
    expect(failed(compare(budgets(), slow))).toBe(true);
    const lavapipe = {
      ...measured,
      compose: { ...measured.compose, p95Ms: 61, software: true, adapter: "llvmpipe (Vulkan)" },
    };
    const verdicts = compare(budgets(), lavapipe);
    expect(status(verdicts)["compose.p95Ms"]).toBe("reported");
    expect(failed(verdicts)).toBe(false);
    expect(report(verdicts)).toMatch(/software adapter llvmpipe/);
  });

  it("fails a press whose paint p95 or whose frame's median is past 16 ms, each on its own", () => {
    const slowPaint = { ...measured, inputToPaint: { ...measured.inputToPaint, p95Ms: 17 } };
    expect(status(compare(budgets(), slowPaint))).toMatchObject({
      "inputToPaint.p95Ms": "over",
      "inputToPaint.frameP50Ms": "ok",
    });
    const slowFrame = { ...measured, inputToPaint: { ...measured.inputToPaint, frameP50Ms: 18 } };
    const verdicts = compare(budgets(), slowFrame);
    expect(status(verdicts)).toMatchObject({
      "inputToPaint.p95Ms": "ok",
      "inputToPaint.frameP50Ms": "over",
    });
    expect(verdicts.find((v) => v.key === "frameP50Ms")).toMatchObject({ high: 16 });
    expect(failed(verdicts)).toBe(true);
  });

  it("fails memory per surface out of #35's band either way", () => {
    for (const [perSurfaceMb, verdict] of [
      [145, "over"],
      [96, "under"],
      [144.8, "ok"],
    ] as const) {
      const run = { ...measured, surfaceMemory: { ...measured.surfaceMemory, perSurfaceMb } };
      const verdicts = compare(budgets(), run);
      expect(status(verdicts)["surfaceMemory.perSurfaceMb"]).toBe(verdict);
      expect(failed(verdicts)).toBe(verdict !== "ok");
    }
  });

  it("reports a baseline taken on another platform or with another tool, and never fails it", () => {
    const linux = {
      ...measured,
      surfaceMemory: { perSurfaceMb: 300, tool: "rss", platform: "linux-x64" },
    };
    const verdicts = compare(budgets(), linux);
    const memory = verdicts.find((v) => v.section === "surfaceMemory");
    expect(memory).toMatchObject({ status: "reported" });
    expect(memory?.note).toMatch(/platform is darwin-arm64, this run's linux-x64/);
    expect(failed(verdicts)).toBe(false);
  });

  it("a section that waits for another issue says so until it is measured", () => {
    const waiting = { ...budgets(), inputToPaint: { p95Ms: null, budgetMs: 16, waitsFor: "#99" } };
    const { inputToPaint: _, ...without } = measured;
    const verdicts = compare(waiting, without);
    expect(status(verdicts)["inputToPaint.p95Ms"]).toBe("waiting");
    expect(failed(verdicts)).toBe(false);
    expect(report(verdicts)).toMatch(/waits for #99/);
  });

  it("records a run as the baselines, keeps the budgets, and then gates the starts", () => {
    const before = budgets();
    const after = withBaselines(before, measured, { recorded: "2026-11-10" });
    expect(after.compose).toMatchObject({ budgetMs: 4, p95Ms: 0.48, medianMs: 0.41 });
    expect(after.composeStartup).toMatchObject({
      firstComposeMs: 180,
      allowedRegression: 0.25,
      platform: "darwin-arm64",
      recorded: "2026-11-10",
    });
    expect(after.surfaceMemory).toMatchObject({ perSurfaceMb: 125, band: 0.2 });
    expect(after.inputToPaint).toMatchObject({
      p95Ms: 8.5,
      budgetMs: 16,
      frameP50Ms: 14.8,
      frameBudgetMs: 16,
      frameP95Ms: 24,
      p50Ms: 6.3,
    });
    expect(before.composeStartup?.firstComposeMs).toBeNull();
    const later = {
      ...measured,
      composeStartup: { ...measured.composeStartup, firstComposeMs: 226 },
      surfaceStartup: { ...measured.surfaceStartup, firstComposeMs: 249 },
    };
    expect(status(compare(after, later))).toMatchObject({
      "composeStartup.firstComposeMs": "over",
      "surfaceStartup.firstComposeMs": "ok",
    });
  });

  it("judges the slowest of the desk's starts against the median's baseline and allowance", () => {
    const recorded = withBaselines(budgets(), measured, { recorded: "2026-11-10" });
    // The median's baseline; the slowest is kept beside it for the trend.
    expect(recorded.surfaceStartup).toMatchObject({ firstComposeMs: 200, slowestMs: 230 });
    const run = (slowestMs: number) => ({
      ...measured,
      surfaceStartup: { ...measured.surfaceStartup, slowestMs },
    });
    const slowest = (slowestMs: number) =>
      compare(recorded, run(slowestMs)).find((v) => v.key === "slowestMs");
    expect(slowest(250)).toMatchObject({ status: "ok", high: 250 });
    // A start that stalls 1.4 s before CEF is up (#112) fails, though the median holds.
    expect(slowest(1610)).toMatchObject({ status: "over", value: 1610, high: 250 });
    const verdicts = compare(recorded, run(1610));
    expect(status(verdicts)["surfaceStartup.firstComposeMs"]).toBe("ok");
    expect(failed(verdicts)).toBe(true);
    expect(report(verdicts)).toMatch(/slowest +1610 ms +pass <= 250 ms +OVER/);
  });

  it("a measurement that did not finish is missing", () => {
    const verdicts = compare(budgets(), { compose: measured.compose });
    expect(status(verdicts)["surfaceMemory.perSurfaceMb"]).toBe("missing");
    expect(report(verdicts)).toMatch(/missing/);
  });

  it("the committed budgets.json holds every compositor section with its reason", () => {
    const committed = JSON.parse(
      readFileSync(new URL("../budgets.json", import.meta.url), "utf8"),
    ) as Budgets;
    for (const gate of GATES) {
      const section = committed[gate.section];
      expect(section, gate.section).toBeDefined();
      expect(typeof section?.reason, `${gate.section}.reason`).toBe("string");
      expect(gate.key in (section ?? {}), `${gate.section}.${gate.key}`).toBe(true);
    }
    expect(committed.compose).toMatchObject({
      budgetMs: 4,
      surfaces: 15,
      width: 2560,
      height: 1440,
    });
    expect(committed.surfaceMemory).toMatchObject({
      perSurfaceMb: 120.7,
      band: 0.2,
      tool: "footprint",
    });
    expect(committed.inputToPaint).toMatchObject({ budgetMs: 16, frameBudgetMs: 16, tries: 20 });
    // The desk's start is the median of ten starts again (#112), not the fastest of five.
    expect(committed.surfaceStartup).toMatchObject({ runs: 10, allowedRegression: 0.25 });
    expect(committed.surfaceStartup?.reason).toMatch(/median of ten/);
  });
});
