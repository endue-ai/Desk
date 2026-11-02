// The app's performance budgets in e2e/perf/budgets.json: second-start times, idle memory and input
// latency, each compared with its baseline (recorded on the CI runner) and failing past the
// section's allowedRegression. Without a baseline a value is reported, never failed. The RT-16
// targets (`targetMs`) are printed beside the values and are not gates. `openingFrameTime` belongs
// to `just perf-opening` and is left as it is. Pure: budgets.test.ts.
import { round1 } from "./stats";

export type Section = "startup" | "idleMemory" | "inputLatency";

export interface Measure {
  section: Section;
  key: string;
  label: string;
  unit: "ms" | "MB";
}

/** What the runner measures, in budgets.json's sections and keys. */
export const MEASURES: readonly Measure[] = [
  { section: "startup", key: "readyMs", label: "second start to the ready line", unit: "ms" },
  {
    section: "startup",
    key: "firstFrameMs",
    label: "second start to the first interactive frame",
    unit: "ms",
  },
  { section: "idleMemory", key: "rssMb", label: "RSS 5 min after start", unit: "MB" },
  {
    section: "inputLatency",
    key: "paletteP95Ms",
    label: "palette open to visible, p95",
    unit: "ms",
  },
  { section: "inputLatency", key: "focusP95Ms", label: "surface focus switch, p95", unit: "ms" },
];

/** budgets.json, by section. */
export type Budgets = Record<string, Record<string, unknown> | undefined>;
/** What the runner measured, by section (the spec files' results merged). */
export type Measured = Partial<Record<Section, Record<string, unknown>>>;

export type Status = "ok" | "over" | "no-baseline" | "missing";

export interface Verdict extends Measure {
  value: number | null;
  baseline: number | null;
  /** The baseline with its allowance: a value above it fails. */
  limit: number | null;
  /** The RT-16 target, printed only. */
  target: number | null;
  status: Status;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function compare(budgets: Budgets, measured: Measured): Verdict[] {
  return MEASURES.map((measure) => {
    const budget = budgets[measure.section] ?? {};
    const value = num(measured[measure.section]?.[measure.key]);
    const baseline = num(budget[measure.key]);
    const allowance = 1 + (num(budget.allowedRegression) ?? 0);
    const status: Status =
      value === null
        ? "missing"
        : baseline === null
          ? "no-baseline"
          : value > baseline * allowance
            ? "over"
            : "ok";
    return {
      ...measure,
      value,
      baseline,
      limit: baseline === null ? null : round1(baseline * allowance),
      target: num(budget.targetMs),
      status,
    };
  });
}

/** Whether any value went past its baseline's allowance. */
export function failed(verdicts: readonly Verdict[]): boolean {
  return verdicts.some((verdict) => verdict.status === "over");
}

/** budgets.json with this run's values as the baselines of the app's sections. */
export function withBaselines(
  budgets: Budgets,
  measured: Measured,
  meta: { platform: string; recorded: string },
): Budgets {
  const next: Budgets = structuredClone(budgets);
  for (const measure of MEASURES) {
    const value = num(measured[measure.section]?.[measure.key]);
    if (value === null) continue;
    const section = { ...(next[measure.section] ?? {}) };
    section[measure.key] = value;
    section.platform = meta.platform;
    section.recorded = meta.recorded;
    next[measure.section] = section;
  }
  return next;
}

const STATUS: Record<Status, string> = {
  ok: "ok",
  over: "over the allowance",
  "no-baseline": "no baseline yet: reported, not failed",
  missing: "missing: its measurement did not finish",
};

/** The verdicts as lines for the job's log, the RT-16 targets beside. */
export function report(verdicts: readonly Verdict[]): string {
  const show = (value: number | null, unit: string) =>
    value === null ? "-" : `${value.toFixed(1)} ${unit}`;
  const lines = verdicts.map((v) => {
    const target = v.target === null ? "" : `  RT-16 target ${v.target} ${v.unit}`;
    return (
      `  ${v.label.padEnd(44)} ${show(v.value, v.unit).padStart(10)}` +
      `  baseline ${show(v.baseline, v.unit).padStart(10)}  limit ${show(v.limit, v.unit).padStart(10)}` +
      `  ${STATUS[v.status]}${target}`
    );
  });
  return ["app performance (e2e/perf/budgets.json)", ...lines].join("\n");
}
