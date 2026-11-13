// The motion gate (`just perf-motion [check|record] [--debug] [--screen] [--runs N] [--no-build]
// [--home DIR]`, #247, ADR 0208): a change to the compositor, desk-wm or the off-screen host is judged
// on rendered pixels while a window moves. It builds the optimized shell (development commands on),
// starts it on the Default profile's 13 plugin windows, and per run shakes one window by its title
// bar twice (2 Hz, ±200 px, a move every 8 ms): once timed, once reading frames back. It fails on
// fewer than 55 frames a second, intervals over 25 ms beyond 2 %, a mid-motion frame where the
// window shows pixels not its own, a page that stops painting, and a window at rest after a drop at a
// fractional place softer than at a whole pixel (known until #250). Limits and the baseline live in
// e2e/perf/motion.json; results in e2e/test-results/perf-motion/<variant>. Headless by default: no
// screen, pointer or keyboard of the machine's is used. `--debug` measures the development build for
// the record and never fails. Node strips the types.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, homedir, loadavg, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { decodePng } from "../support/png.ts";
import {
  captured,
  type Line,
  parseTrace,
  type Rect,
  shakes,
  sharpness,
  strayed,
  timing,
} from "./lib/motion.ts";
import {
  failed,
  type Limits,
  type RunFindings,
  table,
  verdicts,
  worst,
} from "./lib/motion-verdicts.ts";
import { drag, poke, shake, startDesk, stopDesk, windows } from "./support/motion-desk.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const CONFIG = join(here, "motion.json");
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const mode = argv.find((a) => a === "check" || a === "record") ?? "check";
const debug = argv.includes("--debug");
const screen = argv.includes("--screen");
const runs = Number(flag("--runs") ?? 3);
const variant = `${debug ? "debug" : "optimized"}-${screen ? "screen" : "offscreen"}`;
const OUT = join(root, "e2e/test-results/perf-motion", variant);
const BUNDLE = join(root, debug ? "target/bundle-motion-debug" : "target/bundle-motion");
const BINARY = join(BUNDLE, "endue-desk.app/Contents/MacOS/endue-desk");

interface Config {
  window: string;
  windows: number;
  shake: {
    amp: number;
    periodMs: number;
    stepMs: number;
    durationMs: number;
    captures: number;
    drop: number[];
  };
  limits: Limits;
  known: Record<string, string>;
  baseline: Record<string, unknown>;
}
const config = JSON.parse(readFileSync(CONFIG, "utf8")) as Config;

function run(command: string, args: string[]): void {
  console.log(`perf-motion: ${command} ${args.join(" ")}`);
  const env = { ...process.env, CARGO_INCREMENTAL: "0" };
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env });
  if (result.status !== 0) {
    console.error(`perf-motion: ${command} failed`);
    process.exit(1);
  }
}

/** The shell as measured: optimized with debug assertions (its development commands), or debug. */
function build(): void {
  run("pnpm", ["--filter", "@endue-ai/desk-app", "build"]);
  const assertions = "profile.release.package.desk-shell.debug-assertions=true";
  run("cargo", [
    "build",
    "-p",
    "desk-shell",
    "--bins",
    ...(debug ? [] : ["--release", "--config", assertions]),
  ]);
  rmSync(BUNDLE, { recursive: true, force: true });
  const bundle = ["--features", "bundle", "--bin", "desk-shell-bundle", "--", BUNDLE];
  run("cargo", ["run", "-q", "-p", "desk-shell", ...bundle, debug ? "debug" : "release"]);
}

/** One run: a fresh desk, the window placed at whole pixels, a timed shake, a captured one, a poke. */
async function once(
  n: number,
): Promise<{ findings: RunFindings; detail: Record<string, unknown> }> {
  const dir = join(OUT, `run-${n}`);
  mkdirSync(dir, { recursive: true });
  const home = flag("--home") ?? mkdtempSync(join(tmpdir(), "desk-motion-"));
  if (resolve(home) === homedir()) throw new Error("--home must not be your own home");
  const trace = join(dir, "trace.jsonl");
  const log = join(dir, "desk.log");
  const desk = await startDesk({
    binary: BINARY,
    root,
    home,
    log,
    trace,
    screen,
    windows: config.windows,
  });
  try {
    const { amp, periodMs, stepMs, durationMs, captures, drop } = config.shake;
    const { screen: [sw = 0] = [], windows: all } = await windows(desk.port);
    const w = all.find((w) => w.id === config.window);
    if (!w) throw new Error(`no window ${config.window} on the desk: ${all.map((w) => w.id)}`);
    const [x = 0, y = 0, width = 0] = w.rect;
    // Its title bar, clear of the icon and the tools; the window to whole pixels first.
    const grip = [x + Math.round(width * 0.4), y + 16];
    const whole = [Math.round(x) - x, Math.round(y) - y];
    if (whole[0] || whole[1]) {
      await drag(desk.port, grip, [
        (grip[0] ?? 0) + (whole[0] ?? 0),
        (grip[1] ?? 0) + (whole[1] ?? 0),
      ]);
    }
    const at = [Math.round(grip[0] ?? 0), Math.round(grip[1] ?? 0)];
    if (x - amp < 0 || x + width + amp > sw)
      throw new Error(`${config.window} cannot swing ±${amp} px`);
    const swing = { x: at[0], y: at[1], amp, periodMs, stepMs, durationMs };
    await shake(desk, { ...swing, tag: "timed" });
    const path = (name: string) => join(dir, `${name}.png`);
    const spread = Array.from({ length: captures }, (_, i) => ({
      atMs: Math.round(((i + 0.5) * (durationMs - 1000)) / captures),
      path: path(`swing-${String(i).padStart(2, "0")}`),
    }));
    await shake(desk, {
      ...swing,
      durationMs: durationMs - 1000,
      tag: "captured",
      rest: path("rest"),
      captures: spread,
      drop,
      dropped: path("dropped"),
    });
    const poked = await poke(desk.port);
    // The stall watch says a page stopped after three asks a second apart (`stall.rs`).
    await delay(4_000);
    const alive = await desk.desk.exits(0).then((gone) => !gone);
    const lines = parseTrace(readFileSync(trace, "utf8"));
    const result = analyze(lines, readFileSync(log, "utf8"), poked, alive);
    result.detail.rested = desk.rested;
    result.detail.load = loadavg().map((l) => Math.round(l * 10) / 10);
    return result;
  } finally {
    await stopDesk(desk);
    if (!flag("--home")) rmSync(home, { recursive: true, force: true });
  }
}

/** What the run's trace, frames and poke say. */
function analyze(
  lines: Line[],
  log: string,
  poked: { poked: string[]; unpainted: string[] },
  alive: boolean,
): { findings: RunFindings; detail: Record<string, unknown> } {
  const { limits } = config;
  const all = shakes(lines);
  const timed = all.find((s) => s.tag === "timed");
  const capturedShake = all.find((s) => s.tag === "captured");
  const stopped = [
    ...poked.unpainted.map((s) => `${s} painted nothing when touched`),
    ...lines.filter((l) => l.e === "stall").map((l) => `${l.f.surface} stalled (#157 watch)`),
    ...lines.filter((l) => l.e === "replaced").map((l) => `${l.f.surface} replaced: ${l.f.why}`),
    ...(lines.filter((l) => l.e === "start").length > 1
      ? ["the desk started again (ADR 0202)"]
      : []),
    ...(alive ? [] : ["the desk ended"]),
  ];
  const t = timed ? timing(timed, limits.longIntervalMs, screen) : undefined;
  const frames = capturedShake ? captured(capturedShake, config.window) : [];
  const rest = frames.find((f) => f.tag === "rest");
  const img = (p: string) => decodePng(readFileSync(p));
  const restImage = rest ? img(rest.path) : undefined;
  const restSharp = restImage && rest ? sharpness(restImage, rest.rect) : 0;
  const compared = frames
    .filter((f) => f.tag === "swing" && restImage && rest)
    .map((f) => ({ f, s: strayed(restImage as never, rest?.rect as Rect, img(f.path), f.rect) }));
  const foreign = compared.filter(({ s }) => s.differing >= limits.foreignBlocks);
  const dropped = frames.find((f) => f.tag === "dropped");
  const droppedSharp = dropped ? sharpness(img(dropped.path), dropped.rect) : 0;
  const moved =
    compared.length > 0 && compared.some(({ f }) => Math.abs(f.rect.x - (rest?.rect.x ?? 0)) > 50);
  const invalid =
    !t || t.frames === 0
      ? "no frames traced while the window swung"
      : !rest || !moved
        ? "the window did not move with the pointer"
        : screen && t.unseen > 0
          ? `${t.unseen} frames not presented (a locked or covered screen: run without --screen)`
          : undefined;
  const findings: RunFindings = {
    fps: t?.fps ?? 0,
    longShare: t?.longShare ?? 1,
    intervalP95: t?.intervals.p95 ?? 0,
    intervalMax: t?.intervals.max ?? 0,
    swingFrames: compared.length,
    foreignFrames: foreign.length,
    fromDeskPage: frames.filter((f) => !f.own).length,
    restSharpness: restSharp ? droppedSharp / restSharp : 0,
    stopped,
    ...(invalid ? { invalid } : {}),
  };
  const detail = {
    timing: t,
    poked: poked.poked.length,
    frames: compared.map(({ f, s }) => ({ path: f.path, rect: f.rect, own: f.own, ...s })),
    dropped: dropped?.rect,
    stoppedInLog: log.split("\n").filter((l) => /stopped painting|starting a new desk/.test(l)),
  };
  return { findings, detail };
}

async function main(): Promise<void> {
  if (mode !== "check" && mode !== "record")
    throw new Error(`mode is check or record, not ${mode}`);
  if (!argv.includes("--no-build")) build();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const started = Date.now();
  const results = [];
  for (let n = 1; n <= runs; n++) {
    console.log(`perf-motion: ${variant}, run ${n} of ${runs}`);
    results.push(await once(n));
    console.log(`perf-motion: run ${n}: ${JSON.stringify(results.at(-1)?.findings)}`);
  }
  const found = worst(results.map((r) => r.findings));
  const all = verdicts(found, config.limits, config.known);
  const date = new Date().toISOString();
  const commit = spawnSync("git", ["rev-parse", "--short=8", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  const machine = `${cpus()[0]?.model ?? "?"}, ${process.platform}`;
  const load = results.map((r) => (r.detail.load as number[] | undefined)?.[0]);
  const summary = { date, commit: commit.stdout.trim(), machine, variant, runs, load, found };
  writeFileSync(
    join(OUT, "results.json"),
    `${JSON.stringify({ ...summary, verdicts: all, runs: results }, null, 2)}\n`,
  );
  const took = Math.round((Date.now() - started) / 1000);
  console.log(
    `\nperf-motion: ${variant}, ${runs} runs in ${took} s, load average ${load.join(", ")}`,
  );
  if (load.some((l) => (l ?? 0) > cpus().length / 2)) {
    console.log("perf-motion: the machine was busy (load above half its cores): timings run slow");
  }
  console.log(table(all));
  if (mode === "record") {
    config.baseline[variant] = summary;
    writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`perf-motion: recorded as the ${variant} baseline in e2e/perf/motion.json`);
  }
  if (debug) {
    console.log(
      "perf-motion: the debug build is measured for the record; the gate is the optimized build",
    );
  } else if (failed(all)) {
    console.error("perf-motion: the motion gate fails (the table above)");
    process.exitCode = 1;
  }
}

main().catch((why: unknown) => {
  console.error(`perf-motion: ${why instanceof Error ? why.message : String(why)}`);
  process.exit(1);
});
