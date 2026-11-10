// The compositor's budgets in e2e/perf/budgets.json (`just perf-compositor`, #58): the compose
// budget and the compositor's own start from the compose bench; the desk's start to its first
// composed web surface (the median of ten starts, and the slowest of them against the same
// allowance: #112), the memory per live surface, a press to its paint and to the composed frame
// holding it (on #56's input path), a press CEF's busy-wait caught, a press on a desk at rest
// (#133), and the desk's wake-ups and CPU at rest (#129) and a resting page's own change to its
// paint (#134) from the shell's surface probe. Three
// kinds of gate: a
// budget the value stays under, a baseline it may regress past by `allowedRegression`, and a
// baseline it stays within `band` of, either way. A budget on a software adapter, and a baseline
// recorded on another platform or with another tool, are reported and never failed. Pure:
// compositor.test.ts.
import { round1 } from "./stats.ts";

export type Kind = "budget" | "regression" | "band";

export interface Gate {
  section: string;
  key: string;
  label: string;
  unit: "ms" | "MB" | "/s" | "%";
  kind: Kind;
  /** A budget's key in its section, `budgetMs` unless named. */
  budgetKey?: string;
  /** The key of the baseline a regression or band gate is judged against, its own unless named. */
  baselineKey?: string;
}

export const GATES: readonly Gate[] = [
  {
    section: "compose",
    key: "p95Ms",
    label: "compose, 15 surfaces at 2560x1440, p95",
    unit: "ms",
    kind: "budget",
  },
  {
    section: "composeStartup",
    key: "firstComposeMs",
    label: "compositor start to its first frame",
    unit: "ms",
    kind: "regression",
  },
  {
    section: "surfaceStartup",
    key: "firstComposeMs",
    label: "desk start to a web surface, median",
    unit: "ms",
    kind: "regression",
  },
  {
    section: "surfaceStartup",
    key: "slowestMs",
    label: "desk start to a web surface, slowest",
    unit: "ms",
    kind: "regression",
    baselineKey: "firstComposeMs",
  },
  {
    section: "surfaceMemory",
    key: "perSurfaceMb",
    label: "memory per live surface",
    unit: "MB",
    kind: "band",
  },
  {
    section: "inputToPaint",
    key: "p95Ms",
    label: "a press to its paint, p95",
    unit: "ms",
    kind: "budget",
  },
  {
    section: "inputToPaint",
    key: "frameP50Ms",
    label: "a press to its composed frame, median",
    unit: "ms",
    kind: "budget",
    budgetKey: "frameBudgetMs",
  },
  {
    section: "inputToPaint",
    key: "caughtWaitMs",
    label: "a caught press's paint after the busy-wait",
    unit: "ms",
    kind: "budget",
    budgetKey: "caughtWaitBudgetMs",
  },
  {
    section: "inputFromRest",
    key: "p95Ms",
    label: "a press on a desk at rest 2 s or more, p95",
    unit: "ms",
    kind: "budget",
  },
  {
    section: "deskAtRest",
    key: "wakeupsPerSecond",
    label: "desk at rest, its loop's wake-ups",
    unit: "/s",
    kind: "budget",
    budgetKey: "wakeupsBudget",
  },
  {
    section: "deskAtRest",
    key: "cpuPercent",
    label: "desk at rest, the browser process's CPU",
    unit: "%",
    kind: "budget",
    budgetKey: "cpuBudgetPercent",
  },
  {
    section: "deskAtRest",
    key: "ownChangeMs",
    label: "desk at rest, a page's own change to its paint",
    unit: "ms",
    kind: "budget",
    budgetKey: "ownChangeBudgetMs",
  },
];

/** What a gate's section keeps besides its value when a run is recorded as the baseline. */
const RECORDED: Record<string, readonly string[]> = {
  compose: ["medianMs", "adapter", "platform"],
  composeStartup: ["adapter", "platform"],
  surfaceStartup: ["platform"],
  surfaceMemory: ["tool", "platform"],
  inputToPaint: ["p50Ms", "frameP95Ms", "caughtPaintP50Ms", "adapter", "platform"],
  inputFromRest: ["p50Ms", "maxMs", "frameP50Ms", "adapter", "platform"],
  deskAtRest: [
    "osWakeupsPerSecond",
    "cefWorksPerSecond",
    "beginFramesPerSecond",
    "ownChangeMaxMs",
    "platform",
  ],
};

export type Status = "ok" | "over" | "under" | "reported" | "no-baseline" | "missing" | "waiting";

export interface Verdict extends Gate {
  value: number | null;
  /** The lowest and highest value that pass; `null` where a gate has no such end. */
  low: number | null;
  high: number | null;
  status: Status;
  /** Why a value is reported rather than judged, or what it waits for. */
  note: string | null;
}

type Section = Record<string, unknown>;
export type Budgets = Record<string, Section | undefined>;
export type Measured = Record<string, Section | undefined>;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

function judge(gate: Gate, budget: Section, measured: Section): Verdict {
  const value = num(measured[gate.key]);
  const verdict = (
    status: Status,
    low: number | null,
    high: number | null,
    note = null as string | null,
  ) => ({
    ...gate,
    value,
    low,
    high,
    status,
    note,
  });
  if (value === null) {
    const waits = text(budget.waitsFor);
    return waits
      ? verdict("waiting", null, null, `waits for ${waits}`)
      : verdict("missing", null, null);
  }
  if (gate.kind === "budget") {
    const high = num(budget[gate.budgetKey ?? "budgetMs"]);
    if (high === null) return verdict("no-baseline", null, null);
    if (measured.software === true) {
      return verdict(
        "reported",
        null,
        high,
        `software adapter ${text(measured.adapter) ?? ""}`.trim(),
      );
    }
    return verdict(value > high ? "over" : "ok", null, high);
  }
  const baseline = num(budget[gate.baselineKey ?? gate.key]);
  if (baseline === null) return verdict("no-baseline", null, null);
  const elsewhere = [
    ["platform", text(budget.platform), text(measured.platform)],
    ["tool", text(budget.tool), text(measured.tool)],
  ].find(([, recorded, now]) => recorded !== null && now !== null && recorded !== now);
  const [low, high] =
    gate.kind === "band"
      ? [
          round1(baseline * (1 - (num(budget.band) ?? 0))),
          round1(baseline * (1 + (num(budget.band) ?? 0))),
        ]
      : [null, round1(baseline * (1 + (num(budget.allowedRegression) ?? 0)))];
  if (elsewhere) {
    return verdict(
      "reported",
      low,
      high,
      `baseline's ${elsewhere[0]} is ${elsewhere[1]}, this run's ${elsewhere[2]}`,
    );
  }
  if (high !== null && value > high) return verdict("over", low, high);
  if (low !== null && value < low) return verdict("under", low, high);
  return verdict("ok", low, high);
}

export function compare(budgets: Budgets, measured: Measured): Verdict[] {
  return GATES.map((gate) =>
    judge(gate, budgets[gate.section] ?? {}, measured[gate.section] ?? {}),
  );
}

/** Whether a value went past its budget, or out of its baseline's allowance or band. */
export function failed(verdicts: readonly Verdict[]): boolean {
  return verdicts.some((v) => v.status === "over" || v.status === "under");
}

/** budgets.json with this run's values as the compositor sections' baselines (budgets stay). */
export function withBaselines(
  budgets: Budgets,
  measured: Measured,
  meta: { recorded: string },
): Budgets {
  const next: Budgets = structuredClone(budgets);
  for (const gate of GATES) {
    const values = measured[gate.section];
    const value = num(values?.[gate.key]);
    if (!values || value === null) continue;
    const section: Section = { ...(next[gate.section] ?? {}), [gate.key]: value };
    for (const key of RECORDED[gate.section] ?? []) {
      if (values[key] !== undefined) section[key] = values[key];
    }
    if (gate.kind === "band") section.source = "just perf-compositor record";
    section.recorded = meta.recorded;
    next[gate.section] = section;
  }
  return next;
}

const STATUS: Record<Status, string> = {
  ok: "ok",
  over: "OVER",
  under: "UNDER the band: a stale baseline, or the surfaces did not render",
  reported: "reported, not judged",
  "no-baseline": "no baseline yet: reported, not failed",
  missing: "missing: its measurement did not finish",
  waiting: "waiting",
};

/** The verdicts as lines for the log. */
export function report(verdicts: readonly Verdict[]): string {
  const show = (value: number | null, unit: string) => (value === null ? "-" : `${value} ${unit}`);
  const lines = verdicts.map((v) => {
    const range =
      v.low === null ? `<= ${show(v.high, v.unit)}` : `${v.low} to ${show(v.high, v.unit)}`;
    const note = v.note ? ` (${v.note})` : "";
    return `  ${v.label.padEnd(42)} ${show(v.value, v.unit).padStart(12)}  pass ${range.padEnd(20)} ${STATUS[v.status]}${note}`;
  });
  return ["compositor performance (e2e/perf/budgets.json)", ...lines].join("\n");
}
