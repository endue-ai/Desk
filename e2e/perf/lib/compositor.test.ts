import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Budgets, compare, failed, GATES, report, withBaselines } from "./compositor.ts";

/** The compositor sections as committed: the compose budget, #35's memory baseline, the rest open. */
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
    inputToPaint: { p95Ms: null, budgetMs: 16, waitsFor: "#56" },
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
  surfaceStartup: { firstComposeMs: 200, ...reference },
  surfaceMemory: { perSurfaceMb: 125, tool: "footprint", ...reference },
};

const status = (verdicts: ReturnType<typeof compare>) =>
  Object.fromEntries(verdicts.map((v) => [`${v.section}.${v.key}`, v.status]));

describe("compositor budgets", () => {
  it("gates five values: compose, both starts, memory per surface and input to paint", () => {
    expect(GATES.map((g) => `${g.section}.${g.key}:${g.kind}`)).toEqual([
      "compose.p95Ms:budget",
      "composeStartup.firstComposeMs:regression",
      "surfaceStartup.firstComposeMs:regression",
      "surfaceMemory.perSurfaceMb:band",
      "inputToPaint.p95Ms:budget",
    ]);
  });

  it("passes within the budget and the band, and waits for input to paint", () => {
    const verdicts = compare(budgets(), measured);
    expect(status(verdicts)).toEqual({
      "compose.p95Ms": "ok",
      "composeStartup.firstComposeMs": "no-baseline",
      "surfaceStartup.firstComposeMs": "no-baseline",
      "surfaceMemory.perSurfaceMb": "ok",
      "inputToPaint.p95Ms": "waiting",
    });
    expect(failed(verdicts)).toBe(false);
    const memory = verdicts.find((v) => v.section === "surfaceMemory");
    expect(memory).toMatchObject({ low: 96.6, high: 144.8 });
    expect(report(verdicts)).toMatch(/waits for #56/);
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
    expect(after.inputToPaint).toEqual(before.inputToPaint);
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
    expect(committed.inputToPaint).toMatchObject({ budgetMs: 16, waitsFor: "#56" });
  });
});
