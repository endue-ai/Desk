// The motion gate's main scenario (#258, ADR 0208): the app window grown and shrunk on two sines
// (`compositor_window { sway }`) while a window inside the desk shakes at another rhythm, both fed
// through the event loop; then, the app window at rest, where each window sits, how sharp the shaken
// one is after its drop, and whether every page still paints. motion.ts runs it after the single
// shake; what the trace says of it is lib/motion-sway.ts, what the windows' own pages note of their
// sections through it lib/motion-sections.ts (#270).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { decodePng } from "../support/png.ts";
import { captured, type Line, type Rect, STRAY, sharpness, strayed, timing } from "./lib/motion.ts";
import { type SectionSample, sectionFit } from "./lib/motion-sections.ts";
import { lastLaid, overlap, pictures, shakeOf, swayOf, unsettled } from "./lib/motion-sway.ts";
import type { Limits, SwayFindings } from "./lib/motion-verdicts.ts";
import {
  capture,
  drag,
  type Frame,
  type MotionDesk,
  poke,
  shake,
  snap,
  sway,
  swayed,
  windows,
} from "./support/motion-desk.ts";
import { readSections, watchSections } from "./support/sections.ts";

export interface SwayConfig {
  ampW: number;
  ampH: number;
  periodMs: number;
  periodHMs: number;
  stepMs: number;
  durationMs: number;
  delayMs: number;
  captures: number;
  drop: number[];
  settleMs: number;
  /** A window filling a part of the app before the sway, so its picture follows the app's size. */
  fill: { window: string; fill: string };
}

/** What the run did that the trace does not say. */
export interface SwayRun {
  frames?: { from: Frame; mid: Frame; to: Frame };
  /** Where the desk's log stood when the sway began: what it says after is the sway's. */
  logFrom: number;
  /** How many lines the trace had once the app window settled. */
  settledLines?: number;
  /** The shaken window dragged on by whole pixels after the sway: the drop's sharpness against it. */
  ref?: { path: string; rect: Rect };
  poked: { poked: string[]; unpainted: string[] };
  /** The windows whose own page watched its section in the sway, and what each noted (#270). */
  watched?: string[];
  sections?: Record<string, SectionSample[]>;
  alive: boolean;
  /** Why the run stopped short (a desk that restarted mid-sway, say). */
  error?: string;
}

const lineCount = (trace: string) => readFileSync(trace, "utf8").split("\n").filter(Boolean).length;
const restarted = (trace: string) =>
  readFileSync(trace, "utf8")
    .split("\n")
    .filter((l) => l.includes('"e":"start"')).length > 1;

/** Window `id`'s title bar, clear of its icon and tools, and its rect. */
async function grip(port: number, id: string): Promise<{ at: number[]; rect: Rect }> {
  const w = (await windows(port)).windows.find((w) => w.id === id);
  if (!w) throw new Error(`no window ${id} on the desk`);
  const [x = 0, y = 0, width = 0, h = 0] = w.rect;
  return {
    at: [Math.round(x + width * 0.4), Math.round(y + 16)],
    rect: { x, y, w: width, h },
  };
}

/** Sway the app window while window `id` shakes, then let it settle, drag the window on by whole
 * pixels for a sharp reference, poke every page and give the stall watch its time. */
export async function runSway(
  desk: MotionDesk,
  cfg: SwayConfig,
  swing: { amp: number; periodMs: number; stepMs: number },
  id: string,
  dir: string,
): Promise<SwayRun> {
  const run: SwayRun = {
    logFrom: readFileSync(desk.log, "utf8").length,
    poked: { poked: [], unpainted: [] },
    alive: true,
  };
  const path = (name: string) => join(dir, `${name}.png`);
  try {
    await snap(desk.port, cfg.fill.window, cfg.fill.fill);
    await delay(1_000);
    run.watched = await watchSections(desk.port);
    const { at } = await grip(desk.port, id);
    const { ampW, ampH, periodMs, periodHMs, stepMs, durationMs, delayMs } = cfg;
    const sways = { ampW, ampH, periodMs, periodHMs, stepMs, durationMs, delayMs, tag: "sway" };
    run.frames = await sway(desk, sways);
    // The shake's swing starts about 500 ms after it is asked for, so the sway starts
    // `delayMs - 500` into it; the swing outlasts the sway by 400 ms, and the drop comes after.
    const lead = delayMs - 500;
    const captures = Array.from({ length: cfg.captures }, (_, i) => ({
      atMs: Math.round(lead + ((i + 0.5) * durationMs) / cfg.captures),
      path: path(`sway-${String(i).padStart(2, "0")}`),
    }));
    await shake(desk, {
      x: at[0],
      y: at[1],
      ...swing,
      durationMs: lead + durationMs + 400,
      tag: "swayed",
      rest: path("sway-rest"),
      captures,
      drop: cfg.drop,
      dropped: path("sway-dropped"),
    });
    if (!(await swayed(desk, 1, 5_000))) throw new Error("the sway did not end");
    await delay(cfg.settleMs);
    if (restarted(desk.trace)) throw new Error("the desk started again (ADR 0202)");
    run.sections = await readSections(desk.port);
    run.settledLines = lineCount(desk.trace);
    const before = await grip(desk.port, id);
    await drag(desk.port, before.at, [(before.at[0] ?? 0) + 8, before.at[1] ?? 0]);
    await capture(desk.port, path("sway-ref"));
    run.ref = { path: path("sway-ref"), rect: (await grip(desk.port, id)).rect };
    run.poked = await poke(desk.port);
    // The stall watch says a page stopped after three asks a second apart (`stall.rs`).
    await delay(4_000);
  } catch (why) {
    run.error = why instanceof Error ? why.message : String(why);
  }
  run.alive = !(await desk.desk.exits(0)) && !restarted(desk.trace);
  return run;
}

/** What the trace from line `from` on (the sway's shake's press), the desk's log and the run say. */
export function analyzeSway(
  trace: readonly Line[],
  from: number,
  log: string,
  run: SwayRun,
  id: string,
  limits: Limits,
  screen: boolean,
): { findings: SwayFindings; detail: Record<string, unknown> } {
  // A desk started again (ADR 0202) writes on with a clock of its own: the first desk's lines.
  const all = trace.slice(from);
  const next = all.findIndex((l) => l.e === "start");
  const lines = next < 0 ? all : all.slice(0, next);
  const s = swayOf(lines);
  const shaken = shakeOf(lines, "swayed");
  const both = s && shaken ? overlap(shaken, s) : undefined;
  const t = both ? timing(both, limits.longIntervalMs, screen) : undefined;
  const pics = both ? pictures(lines, both.swing[0], both.swing[1]) : undefined;
  const frames = shaken ? captured(shaken, id) : [];
  const img = (p: string) => decodePng(readFileSync(p));
  const rest = frames.find((f) => f.tag === "rest");
  const restImage = rest ? img(rest.path) : undefined;
  const sized = (r: Rect) =>
    rest && Math.abs(r.w - rest.rect.w) < 1 && Math.abs(r.h - rest.rect.h) < 1;
  const inside = frames.filter(
    (f) => f.tag === "swing" && both && f.at >= both.swing[0] && f.at <= both.swing[1],
  );
  const compared = inside
    .filter((f) => restImage && rest && sized(f.rect))
    .map((f) => {
      const cover = { a: rest?.over, b: f.over };
      return {
        f,
        s: strayed(restImage as never, rest?.rect as Rect, img(f.path), f.rect, STRAY, cover),
      };
    })
    .filter(({ s }) => s.blocks > 0);
  const foreign = compared.filter(({ s }) => s.differing >= limits.foreignBlocks);
  const dropped = frames.find((f) => f.tag === "dropped");
  const sharp =
    dropped && run.ref
      ? sharpness(img(dropped.path), dropped.rect) / sharpness(img(run.ref.path), run.ref.rect)
      : null;
  const said = log
    .slice(run.logFrom)
    .split("\n")
    .filter((l) => /stopped painting|starting a new desk|started for a stall/.test(l));
  const again = next >= 0 || said.some((l) => l.includes("starting a new desk"));
  const stopped = [
    ...run.poked.unpainted.map((s) => `${s} painted nothing when touched`),
    ...all.filter((l) => l.e === "stall").map((l) => `${l.f.surface} stalled (#157 watch)`),
    ...all.filter((l) => l.e === "replaced").map((l) => `${l.f.surface} replaced: ${l.f.why}`),
    ...(again ? ["the desk started again (ADR 0202)"] : []),
    ...(run.alive || again ? [] : ["the desk ended"]),
  ];
  const settled =
    run.settledLines === undefined ? null : unsettled(lastLaid(trace.slice(0, run.settledLines)));
  const fit = sectionFit(run.sections ?? {});
  const span = (pics?.widths[1] ?? 0) - (pics?.widths[0] ?? 0);
  const invalid = !s
    ? `the sway did not run${run.error ? ` (${run.error})` : ""}`
    : s.cut && !again
      ? `the sway did not end${run.error ? ` (${run.error})` : ""}`
      : !t || t.frames === 0
        ? "no frames traced while the app window swayed and the window shook"
        : span < 100
          ? `the app window did not change size (${pics?.widths.join(" to ")} wide)`
          : screen && t.unseen > 0
            ? `${t.unseen} frames not presented (a locked or covered screen: run without --screen)`
            : undefined;
  const findings: SwayFindings = {
    widths: pics?.widths ?? [0, 0],
    heights: pics?.heights ?? [0, 0],
    fps: t?.fps ?? 0,
    longShare: t?.longShare ?? 1,
    intervalP95: t?.intervals.p95 ?? 0,
    intervalMax: t?.intervals.max ?? 0,
    frames: pics?.frames ?? 0,
    unfitFrames: pics?.unfit ?? 0,
    sceneFrames: pics?.deskUnfit ?? 0,
    sectionFrames: fit.frames,
    unfitSections: fit.unfit,
    swingFrames: compared.length,
    foreignFrames: foreign.length,
    stopped,
    unsettled: settled,
    restSharpness: sharp,
    ...(invalid ? { invalid } : {}),
  };
  const detail = {
    run: { ...run, sections: undefined },
    sections: { watched: run.watched, ...fit },
    timing: t,
    pictures: pics,
    captures: inside.length,
    frames: compared.map(({ f, s }) => ({ path: f.path, rect: f.rect, own: f.own, ...s })),
    sizes: inside.map((f) => f.rect),
    dropped: dropped?.rect,
    stoppedInLog: said,
    unmeasured: run.settledLines === undefined ? (run.error ?? "the run stopped short") : undefined,
  };
  return { findings, detail };
}
