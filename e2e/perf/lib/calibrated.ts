// Budgets judged against the machine they run on (ADR 0362): before each case the process times a
// fixed CPU workload (the calibration, the median of a few runs), and a case's limit is its
// baseline plus its allowance, scaled by how much slower that workload ran than when the baseline
// was recorded. A loaded machine slows the calibration as it slows the case, so load raises the
// limit instead of failing it; a faster moment never lowers it, and the scale stops at a cap, so a
// regression still fails on a busy machine. A baseline recorded on another platform, a case
// without one, and a value past its limit on a machine past BUSY_PER_CORE are reported, never failed. Work done in the process is timed on its CPU clock
// (`cpuClock`), which a busy machine barely moves; a case that waits on a server, on the wall clock.
// Pure but for `calibrate`, `cpuClock` and `fastest`: calibrated.test.ts.
import { median, round1 } from "./stats";

export interface Budget {
  /** The value measured on the reference machine; null until one is recorded. */
  baseline: number | null;
  unit: "ms" | "MiB" | "%";
  /** The calibration's time when the baseline was recorded. */
  calibrationMs: number | null;
  /** The share past the baseline a value may take. */
  allowedRegression: number;
  /** Added to the baseline's allowance, in the case's unit: room for a value of a few units. */
  slack?: number;
  platform: string | null;
  recorded: string | null;
  /** The one-minute load average when the baseline was recorded. */
  load: number | null;
  reason: string;
}

export type Verdict = "pass" | "fail" | "report" | "busy";

/**
 * Past this load average per core no value is failed, only reported as busy: at twice as many runs
 * as cores a case's time is the scheduler's more than its own, and no calibration follows it.
 */
export const BUSY_PER_CORE = 2;

/** How far the scale may lift a limit: past it, a busy machine fails rather than hides a regression. */
export const SCALE_CAP = 6;

/**
 * How much slower the machine runs the calibration now than at the record, from 1 to the cap; a
 * budget of memory or of CPU share is not a time, and keeps 1.
 */
export function scaleOf(budget: Budget, calibrationMs: number): number {
  if (budget.unit !== "ms" || !budget.calibrationMs || !(calibrationMs > 0)) return 1;
  return Math.min(SCALE_CAP, Math.max(1, calibrationMs / budget.calibrationMs));
}

/** The value a case stays under now, or null without a baseline. */
export function limitOf(budget: Budget, calibrationMs: number): number | null {
  if (budget.baseline === null) return null;
  const allowed = budget.baseline * (1 + budget.allowedRegression) + (budget.slack ?? 0);
  return round1(allowed * scaleOf(budget, calibrationMs));
}

/** `loadPerCore`: the one-minute load average over the cores when the value was measured. */
export function judge(
  budget: Budget,
  value: number,
  calibrationMs: number,
  platform: string,
  loadPerCore = 0,
) {
  const scale = scaleOf(budget, calibrationMs);
  const limit = budget.platform === platform ? limitOf(budget, calibrationMs) : null;
  let verdict: Verdict = limit === null ? "report" : value <= limit ? "pass" : "fail";
  if (verdict === "fail" && loadPerCore > BUSY_PER_CORE) verdict = "busy";
  return { verdict, limit, scale: round1(scale) };
}

/** A case's budget with `value` as its new baseline, taken at that calibration and load. */
export function recorded(
  budget: Budget,
  value: number,
  at: { calibrationMs: number; load: number; platform: string; date: string },
): Budget {
  return {
    ...budget,
    baseline: round1(value),
    calibrationMs: round1(at.calibrationMs),
    load: round1(at.load),
    platform: at.platform,
    recorded: at.date,
  };
}

/**
 * The fastest of `runs` timings of `work`: a budget is for the work, not for a busy moment. A run
 * that answers a number timed its own part (after a setup it does not count), in milliseconds.
 */
export async function fastest(
  runs: number,
  work: (run: number) => Promise<unknown> | unknown,
  now: () => number = () => performance.now(),
): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < runs; run++) {
    const at = now();
    const own = await work(run);
    best = Math.min(best, typeof own === "number" ? own : now() - at);
  }
  return best;
}

/**
 * The calibration: building, sorting, joining, splitting and parsing a quarter of a million short
 * strings, the kind of work the plugin's cases do, about a tenth of a second on the reference
 * machine; the median of `runs`, in milliseconds of the case's clock (the wall's or `cpuClock`). The median, not the fastest: on a
 * loaded machine one run in several still gets a core to itself, so the fastest would read as quiet
 * while a case of several runs and seconds does not.
 */
export function calibrate(runs = 5, now: () => number = () => performance.now()): number {
  const times: number[] = [];
  let sink = 0;
  for (let run = 0; run < runs; run++) {
    const at = now();
    const words: string[] = [];
    for (let i = 0; i < 250_000; i++) words.push(`w${(i * 7919) % 250_000}_${i & 255}`);
    words.sort();
    const text = words.join(",");
    const parts = text.split(/,/u);
    const parsed = JSON.parse(JSON.stringify({ parts })) as { parts: string[] };
    sink += parsed.parts.length;
    times.push(now() - at);
  }
  if (sink === 0) throw new Error("the calibration did no work");
  return median(times);
}

/** The process's CPU time so far, every thread's, in milliseconds: a clock for `fastest`. */
export function cpuClock(): number {
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
}
