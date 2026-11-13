// The motion gate's resize loop (#248, ADR 0210), after the sway: each turn the app window grows or
// shrinks back by four sizes at once, as one turn of a live resize sends them, and a plugin window is
// maximized or restored (each of them in turn), its glide still running when the next turn comes. A
// page that stops painting in it or after it fails the gate, the desk's own included; so does a desk
// started again (ADR 0202), which only a deadlock of the desk's page has caused. The desk is captured
// at the loop's middle turn and once it rests after it (`loop-mid.png`, `loop-rest.png`).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Line } from "./lib/motion.ts";
import { shell } from "./support/devtools.ts";
import {
  capture,
  type Frame,
  type MotionDesk,
  poke,
  type Stats,
  windows,
} from "./support/motion-desk.ts";

export interface LoopConfig {
  times: number;
  gapMs: number;
}

/** What the loop did that the trace does not say. */
export interface LoopRun {
  /** Where the trace and the desk's log stood when the loop began: what comes after is the loop's. */
  linesFrom: number;
  logFrom: number;
  turns: number;
  sizes: number;
  maximizes: number;
  poked: { poked: string[]; unpainted: string[] };
  /** The times the desk told a page its screen again for a size it had not painted. */
  caughtUp?: number;
  /** Why the loop broke off: a desk that quit to start again leaves no DevTools to answer. */
  broke?: string;
}

const lineCount = (trace: string) => readFileSync(trace, "utf8").split("\n").filter(Boolean).length;

/** Every surface's, every window page's and the desk's own page's `caught_up`, added up. */
async function caughtUp(port: number): Promise<number> {
  const stats: Stats = await shell(port, "compositor_stats");
  const counts = [
    ...Object.values(stats.surfaces ?? {}).map((s: Stats) => s?.counts),
    ...Object.values(stats.pages ?? {}).map((s: Stats) => s?.counts),
    stats.page,
  ];
  return counts.reduce((n: number, c: Stats) => n + (Number(c?.caught_up) || 0), 0);
}

/** A picture of the desk in `dir` as `name`, kept to look at: one that fails is not the loop's. */
const picture = (port: number, dir: string | undefined, name: string) =>
  dir ? capture(port, join(dir, `${name}.png`)).catch(() => undefined) : Promise.resolve();

/** Run the loop `cfg.times` turns `cfg.gapMs` apart, the app window back at its first frame after,
 * then poke every page and give the stall watch its time; the desk captured into `dir`. */
export async function runLoop(desk: MotionDesk, cfg: LoopConfig, dir?: string): Promise<LoopRun> {
  const run: LoopRun = {
    linesFrom: lineCount(desk.trace),
    logFrom: readFileSync(desk.log, "utf8").length,
    turns: 0,
    sizes: 0,
    maximizes: 0,
    poked: { poked: [], unpainted: [] },
  };
  const port = desk.port;
  try {
    const first = (await shell(port, "compositor_window", { frame: true })) as Frame;
    const ids = (await windows(port)).windows.map((w) => w.id);
    const at = (k: number): Frame => ({
      ...first,
      width: first.width + k * 24,
      height: first.height + k * 16,
    });
    for (let i = 0; i < cfg.times; i++) {
      for (const k of i % 2 === 0 ? [1, 2, 3, 4] : [3, 2, 1, 0]) {
        await shell(port, "compositor_window", { frame: at(k) });
        run.sizes++;
      }
      const id = ids[Math.floor(i / 2) % ids.length];
      if (id) {
        await shell(port, "compositor_wm", { op: { op: "maximize" }, window: id });
        run.maximizes++;
      }
      run.turns++;
      if (i === Math.floor(cfg.times / 2)) await picture(port, dir, "loop-mid");
      await delay(cfg.gapMs);
    }
    await shell(port, "compositor_window", { frame: first });
    await delay(1_000);
    run.poked = await poke(port);
    // The stall watch says a page stopped after three asks a second apart (`stall.rs`).
    await delay(4_000);
    run.caughtUp = await caughtUp(port);
    await picture(port, dir, "loop-rest");
  } catch (why) {
    run.broke = `the loop broke off after ${run.turns} turns: ${why instanceof Error ? why.message : String(why)}`;
    await delay(4_000);
  }
  return run;
}

/** What the trace and the log from the loop on say: the pages that stopped and a desk started again. */
export function analyzeLoop(
  trace: readonly Line[],
  log: string,
  run: LoopRun | undefined,
): { turns: number; stopped: string[]; detail?: Record<string, unknown> } {
  if (!run) return { turns: 0, stopped: ["the loop did not run: the desk had ended before it"] };
  const lines = trace.slice(run.linesFrom);
  const said = log
    .slice(run.logFrom)
    .split("\n")
    .filter((l) => /stopped painting|starting a new desk|started for a stall/.test(l));
  const again = lines.some((l) => l.e === "start") || said.some((l) => l.includes("new desk"));
  const stopped = [
    ...run.poked.unpainted.map((s) => `${s} painted nothing when touched`),
    ...lines.filter((l) => l.e === "stall").map((l) => `${l.f.surface} stalled (#157 watch)`),
    ...lines.filter((l) => l.e === "replaced").map((l) => `${l.f.surface} replaced: ${l.f.why}`),
    ...(again ? ["the desk started again (ADR 0202)"] : []),
    ...(run.broke ? [run.broke] : []),
  ];
  const caught = lines.filter((l) => l.e === "caught_up").length;
  const { turns, sizes, maximizes, caughtUp } = run;
  const detail = { turns, sizes, maximizes, poked: run.poked.poked.length, caughtUp, caught, said };
  return { turns, stopped, detail };
}
