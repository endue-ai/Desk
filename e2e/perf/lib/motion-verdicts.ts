// The motion gate's verdicts (`just perf-motion`, #247, #258 and #248, ADR 0208, ADR 0213 and ADR
// 0210): each run's findings, the worst of the runs, and each check against the limits in
// e2e/perf/motion.json; the sway's as `sway-` checks of their own, the resize loop's as `loop`. A
// check named in `known` fails today and an issue fixes it: it is reported as known, and once it
// passes the gate fails until it is taken out of `known`, so the fix says so. One named in
// `sometimes` fails today in some runs and not in others: a failure is reported as known, a pass
// passes. Pure: motion.test.ts and motion-sway.test.ts.
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
  /** Turns of the resize loop run, and the pages that stopped painting in it or after it (#248). */
  loopTurns: number;
  loopStopped: string[];
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
  /** Frames of the sway where a window's picture was laid out for another size. */
  maxUnfitFrames: number;
}

type Shaken = "fps" | "smooth" | "own-pixels" | "painting" | "soft" | "valid";
export type Check = Shaken | "loop" | `sway-${Shaken | "sizes" | "scene" | "sections" | "settled"}`;

export interface Verdict {
  check: Check;
  says: string;
  value: number | string;
  limit: number | string;
  passed: boolean;
  /** The issue that fixes a known failure, and whether it fails only at times. */
  known?: string;
  sometimes?: boolean;
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
    loopTurns: sum((r) => r.loopTurns),
    loopStopped: runs.flatMap((r, i) => r.loopStopped.map((s) => `run ${i + 1}: ${s}`)),
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
      check: "loop",
      says: `pages that stopped painting in ${found.loopTurns} turns of app window resizes and window maximizes`,
      value: found.loopStopped.length ? found.loopStopped.join("; ") : "none",
      limit: "none",
      passed: found.loopTurns > 0 && found.loopStopped.length === 0,
    },
    {
      check: "soft",
      says: "sharpness at rest after a drop at a fractional place, against a whole pixel",
      value: round1(found.restSharpness * 100) / 100,
      limit: `>= ${limits.minRestSharpness}`,
      passed: found.restSharpness >= limits.minRestSharpness,
    },
  ];
  return judged(raw, known);
}

/** Each verdict with its known failure, and whether the gate fails on it. */
function judged(
  raw: readonly Omit<Verdict, "known" | "fails">[],
  known: Readonly<Record<string, string>>,
  sometimes: Readonly<Record<string, string>> = {},
): Verdict[] {
  return raw.map((v) => {
    const at = sometimes[v.check];
    if (at) return { ...v, known: at, sometimes: true, fails: false };
    const issue = known[v.check];
    return issue ? { ...v, known: issue, fails: v.passed } : { ...v, fails: !v.passed };
  });
}

/** What one run's sway found (#258): the app window grown and shrunk while a window shook. */
export interface SwayFindings {
  /** The app window's least and largest width and height while both moved, logical pixels. */
  widths: number[];
  heights: number[];
  fps: number;
  longShare: number;
  intervalP95: number;
  intervalMax: number;
  /** Frames while both moved; those where a window's picture was laid out for another size than
   * it was drawn at; those where the desk's own page was, against the scene drawn with it. */
  frames: number;
  unfitFrames: number;
  sceneFrames: number;
  /** Frames the windows' own pages laid out, and those whose section did not fill its page: laid
   * out for another size than the page has (#270, `motion-sections.ts`). */
  sectionFrames?: number;
  unfitSections?: number;
  /** Captures of the shaken window mid-motion compared with it at rest at its size, and those
   * where it showed pixels not its own. */
  swingFrames: number;
  foreignFrames: number;
  stopped: string[];
  /** What was amiss once the app window settled (`motion-sway.ts` `unsettled`); null where the
   * run did not get that far (a desk that started again mid-sway). */
  unsettled: string[] | null;
  /** Sharpness at rest after a drop at a fractional place against a whole pixel; null where the
   * run did not get that far. */
  restSharpness: number | null;
  invalid?: string;
}

/** The worst of the sways: the least app window and the largest, the fewest frames a second. */
export function worstSway(runs: readonly SwayFindings[]): SwayFindings {
  if (runs.length === 0) throw new Error("no runs");
  const min = (f: (r: SwayFindings) => number) => Math.min(...runs.map(f));
  const max = (f: (r: SwayFindings) => number) => Math.max(...runs.map(f));
  const sum = (f: (r: SwayFindings) => number) => runs.reduce((n, r) => n + f(r), 0);
  const each = (f: (r: SwayFindings) => string[] | null) =>
    runs.flatMap((r, i) => (f(r) ?? []).map((s) => `run ${i + 1}: ${s}`));
  const sharp = runs.map((r) => r.restSharpness).filter((v): v is number => v !== null);
  const settled = runs.some((r) => r.unsettled !== null) ? each((r) => r.unsettled) : null;
  const invalid = runs
    .map((r, i) => (r.invalid ? `run ${i + 1}: ${r.invalid}` : ""))
    .filter(Boolean);
  return {
    widths: [min((r) => r.widths[0] ?? 0), max((r) => r.widths[1] ?? 0)],
    heights: [min((r) => r.heights[0] ?? 0), max((r) => r.heights[1] ?? 0)],
    fps: min((r) => r.fps),
    longShare: max((r) => r.longShare),
    intervalP95: max((r) => r.intervalP95),
    intervalMax: max((r) => r.intervalMax),
    frames: sum((r) => r.frames),
    unfitFrames: sum((r) => r.unfitFrames),
    sceneFrames: sum((r) => r.sceneFrames),
    sectionFrames: sum((r) => r.sectionFrames ?? 0),
    unfitSections: sum((r) => r.unfitSections ?? 0),
    swingFrames: sum((r) => r.swingFrames),
    foreignFrames: sum((r) => r.foreignFrames),
    stopped: each((r) => r.stopped),
    unsettled: settled,
    restSharpness: sharp.length ? Math.min(...sharp) : null,
    ...(invalid.length ? { invalid: invalid.join("; ") } : {}),
  };
}

/** Each of the sway's checks of `found` against `limits`, with the known failures. */
export function swayVerdicts(
  found: SwayFindings,
  limits: Limits,
  known: Readonly<Record<string, string>> = {},
  sometimes: Readonly<Record<string, string>> = {},
): Verdict[] {
  const pct = (v: number) => `${round1(v * 100)} %`;
  const span = (a: number[]) => a.map((v) => Math.round(v)).join(" to ");
  const listed = (a: string[]) => (a.length ? a.join("; ") : "none");
  const sharp = found.restSharpness;
  return judged(
    [
      {
        check: "sway-valid",
        says: `every run swayed the app window (${span(found.widths)} wide, ${span(found.heights)} high) while a window shook`,
        value: found.invalid ?? "yes",
        limit: "yes",
        passed: !found.invalid,
      },
      {
        check: "sway-fps",
        says: "frames a second while the app window and a window inside it move",
        value: found.fps,
        limit: `>= ${limits.minFps}`,
        passed: found.fps >= limits.minFps,
      },
      {
        check: "sway-smooth",
        says: `intervals over ${limits.longIntervalMs} ms (p95 ${found.intervalP95} ms, max ${found.intervalMax} ms)`,
        value: pct(found.longShare),
        limit: `<= ${pct(limits.maxLongShare)}`,
        passed: found.longShare <= limits.maxLongShare,
      },
      {
        check: "sway-own-pixels",
        says: `mid-motion frames where the window shows pixels not its own (of ${found.swingFrames} at its size at rest)`,
        value: found.foreignFrames,
        limit: `<= ${limits.maxForeignFrames}`,
        passed: found.swingFrames > 0 && found.foreignFrames <= limits.maxForeignFrames,
      },
      {
        check: "sway-sizes",
        says: `frames where a window shows a picture laid out for another size, cut or padded (of ${found.frames})`,
        value: found.unfitFrames,
        limit: `<= ${limits.maxUnfitFrames}`,
        passed: found.frames > 0 && found.unfitFrames <= limits.maxUnfitFrames,
      },
      {
        check: "sway-scene",
        says: `frames where the desk's own page shows a picture laid out for another size than the scene drawn with it (of ${found.frames})`,
        value: found.sceneFrames,
        limit: `<= ${limits.maxUnfitFrames}`,
        passed: found.frames > 0 && found.sceneFrames <= limits.maxUnfitFrames,
      },
      {
        check: "sway-sections",
        says: `frames where a window's own page lays its section out for another size than the page has (of ${found.sectionFrames ?? 0})`,
        value: found.unfitSections ?? 0,
        limit: `<= ${limits.maxUnfitFrames}`,
        passed:
          (found.sectionFrames ?? 0) > 0 && (found.unfitSections ?? 0) <= limits.maxUnfitFrames,
      },
      {
        check: "sway-painting",
        says: "pages that stopped painting, the desk's own included, and ADR 0202 restarts",
        value: listed(found.stopped),
        limit: "none",
        passed: found.stopped.length === 0,
      },
      {
        check: "sway-settled",
        says: "once the app window settles: windows off their place or the app, pictures of another size",
        value: found.unsettled === null ? "not measured" : listed(found.unsettled),
        limit: "none",
        passed: found.unsettled !== null && found.unsettled.length === 0,
      },
      {
        check: "sway-soft",
        says: "sharpness at rest afterwards: dropped at a fractional place, against a whole pixel",
        value: sharp === null ? "not measured" : round1(sharp * 100) / 100,
        limit: `>= ${limits.minRestSharpness}`,
        passed: sharp !== null && sharp >= limits.minRestSharpness,
      },
    ],
    known,
    sometimes,
  );
}

/** Whether the gate fails. */
export const failed = (all: readonly Verdict[]) => all.some((v) => v.fails);

/** The verdicts as a table for the terminal and the PR. */
export function table(all: readonly Verdict[]): string {
  const state = (v: Verdict) =>
    v.sometimes
      ? v.passed
        ? `pass (fails at times: ${v.known})`
        : `known failure, at times (${v.known})`
      : v.known
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
