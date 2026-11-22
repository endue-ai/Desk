// A case's value held against its budget in e2e/perf/database.json (ADR 0362): `just
// perf-database` judges it against the calibration taken just before it, `just perf-database record`
// writes it as the new baseline with that calibration and the load average. Every line measured is
// printed and kept in e2e/test-results/perf-database/results.json for the pull request.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { type Budget, calibrate, judge, recorded } from "../lib/calibrated";
import { round1 } from "../lib/stats";

// Paths, not URLs: under jsdom (grid.perf.ts) URL is the DOM's, which node:fs does not take.
const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, "../database.json");
const OUT = join(HERE, "../../test-results/perf-database");
const RECORD = process.env.PERF_MODE === "record";
const PLATFORM = `${process.platform}-${process.arch}`;

type Budgets = Record<string, Budget | string>;

const read = () => JSON.parse(readFileSync(FILE, "utf8")) as Budgets;

/**
 * The calibration for the case about to be measured, on the clock the case is timed on (the wall's
 * unless `cpuClock` is given), and the load it was taken at.
 */
export function calibration(now?: () => number) {
  return { calibrationMs: calibrate(5, now), load: loadavg()[0] ?? 0 };
}

/** Judge (or record) `value` as the case `key`; `at` is the calibration taken before measuring it. */
export function hold(key: string, value: number, at: ReturnType<typeof calibration>) {
  const budgets = read();
  const budget = budgets[key];
  if (!budget || typeof budget === "string") throw new Error(`${key} has no budget`);
  // The busier of the moments before and after: a long case can meet load that came during it.
  const load = Math.max(at.load, loadavg()[0] ?? 0);
  const perCore = load / availableParallelism();
  const { verdict, limit, scale } = judge(budget, value, at.calibrationMs, PLATFORM, perCore);
  const line = {
    key,
    value: round1(value),
    unit: budget.unit,
    baseline: budget.baseline,
    limit,
    scale,
    calibrationMs: round1(at.calibrationMs),
    load: round1(load),
    verdict: RECORD ? "recorded" : verdict,
  };
  console.info(
    `perf-database ${key}: ${line.value} ${budget.unit} (baseline ${budget.baseline ?? "none"}, limit ${limit ?? "none"} at ×${scale}, load ${line.load}): ${line.verdict}`,
  );
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, "results.json"), `${JSON.stringify(line)}\n`);
  if (RECORD) {
    const date = new Date().toISOString().slice(0, 10);
    budgets[key] = recorded(budget, value, { ...at, load, platform: PLATFORM, date });
    writeFileSync(FILE, `${JSON.stringify(budgets, null, 2)}\n`);
    return;
  }
  expect(verdict, `${key}: ${line.value} ${budget.unit} past ${limit}`).not.toBe("fail");
}

/** Wait for `test` to hold, every 5 ms, for `ms` at most. */
export async function until(test: () => unknown, ms = 60_000) {
  const end = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
