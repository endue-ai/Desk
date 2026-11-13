// The motion gate's verdicts (`just perf-motion`, #247, ADR 0208): each run's findings, the worst of
// the runs, and each check against the limits in e2e/perf/motion.json. A check named in `known`
// fails today and an issue fixes it: it is reported as known, and once it passes the gate fails
// until it is taken out of `known`, so the fix says so. Pure: motion.test.ts.
import { round1 } from "./stats.ts";

/** What one run of the gate found. */
export interface RunFindings {
  fps: number;
  longShare: number;
  intervalP95: number;
  intervalMax: number;
  /** Frames read back mid-swing, and those where the window showed pixels not its own. */
  swingFrames: number;
  foreignFrames: number;
  /** Frames where the window was drawn from parts of the desk's page, not its own page. */
  fromDeskPage: number;
  /** The window at rest after a drop at a fractional place, as sharp as at a whole pixel (1). */
  restSharpness: number;
  /** Pages that stopped painting: unpainted after a poke, found stalled, replaced, or a restart. */
  stopped: string[];
  /** Why the run tells nothing (the window did not move, no frames): it fails. */
  invalid?: string;
}

export interface Limits {
  minFps: number;
  longIntervalMs: number;
  maxLongShare: number;
  maxForeignFrames: number;
  foreignBlocks: number;
  minRestSharpness: number;
}

export type Check = "fps" | "smooth" | "own-pixels" | "painting" | "soft" | "valid";

export interface Verdict {
  check: Check;
  says: string;
  value: number | string;
  limit: number | string;
  passed: boolean;
  /** The issue that fixes a known failure. */
  known?: string;
  /** Whether the gate fails on it: a failure not known, or a known one that passes now. */
  fails: boolean;
}

/** The worst of the runs: the fewest frames a second, the most long intervals, every stray frame. */
export function worst(runs: readonly RunFindings[]): RunFindings {
  if (runs.length === 0) throw new Error("no runs");
  const min = (f: (r: RunFindings) => number) => Math.min(...runs.map(f));
  const max = (f: (r: RunFindings) => number) => Math.max(...runs.map(f));
  const sum = (f: (r: RunFindings) => number) => runs.reduce((n, r) => n + f(r), 0);
  const invalid = runs
    .map((r, i) => (r.invalid ? `run ${i + 1}: ${r.invalid}` : ""))
    .filter(Boolean);
  return {
    fps: min((r) => r.fps),
    longShare: max((r) => r.longShare),
    intervalP95: max((r) => r.intervalP95),
    intervalMax: max((r) => r.intervalMax),
    swingFrames: sum((r) => r.swingFrames),
    foreignFrames: sum((r) => r.foreignFrames),
    fromDeskPage: sum((r) => r.fromDeskPage),
    restSharpness: min((r) => r.restSharpness),
    stopped: runs.flatMap((r, i) => r.stopped.map((s) => `run ${i + 1}: ${s}`)),
    ...(invalid.length ? { invalid: invalid.join("; ") } : {}),
  };
}

/** Each check of `found` against `limits`, with the known failures. */
export function verdicts(
  found: RunFindings,
  limits: Limits,
  known: Readonly<Record<string, string>> = {},
): Verdict[] {
  const pct = (v: number) => `${round1(v * 100)} %`;
  const raw: Omit<Verdict, "known" | "fails">[] = [
    {
      check: "valid",
      says: "every run shook the window and traced its frames",
      value: found.invalid ?? "yes",
      limit: "yes",
      passed: !found.invalid,
    },
    {
      check: "fps",
      says: "frames a second while the window moves",
      value: found.fps,
      limit: `>= ${limits.minFps}`,
      passed: found.fps >= limits.minFps,
    },
    {
      check: "smooth",
      says: `intervals over ${limits.longIntervalMs} ms (p95 ${found.intervalP95} ms, max ${found.intervalMax} ms)`,
      value: pct(found.longShare),
      limit: `<= ${pct(limits.maxLongShare)}`,
      passed: found.longShare <= limits.maxLongShare,
    },
    {
      check: "own-pixels",
      says: `mid-motion frames where the window shows pixels not its own (of ${found.swingFrames})`,
      value: found.foreignFrames,
      limit: `<= ${limits.maxForeignFrames}`,
      passed: found.swingFrames > 0 && found.foreignFrames <= limits.maxForeignFrames,
    },
    {
      check: "painting",
      says: "pages that stopped painting",
      value: found.stopped.length ? found.stopped.join("; ") : "none",
      limit: "none",
      passed: found.stopped.length === 0,
    },
    {
      check: "soft",
      says: "sharpness at rest after a drop at a fractional place, against a whole pixel",
      value: round1(found.restSharpness * 100) / 100,
      limit: `>= ${limits.minRestSharpness}`,
      passed: found.restSharpness >= limits.minRestSharpness,
    },
  ];
  return raw.map((v) => {
    const issue = known[v.check];
    return issue ? { ...v, known: issue, fails: v.passed } : { ...v, fails: !v.passed };
  });
}

/** Whether the gate fails. */
export const failed = (all: readonly Verdict[]) => all.some((v) => v.fails);

/** The verdicts as a table for the terminal and the PR. */
export function table(all: readonly Verdict[]): string {
  const state = (v: Verdict) =>
    v.known
      ? v.passed
        ? `FIXED: take it out of known (${v.known})`
        : `known failure (${v.known})`
      : v.passed
        ? "pass"
        : "FAIL";
  const rows = all.map((v) => `| ${v.check} | ${v.says} | ${v.value} | ${v.limit} | ${state(v)} |`);
  return [
    "| check | what | value | limit | verdict |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}
