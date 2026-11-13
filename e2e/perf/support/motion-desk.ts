// The desk the motion gate measures (`e2e/perf/motion.ts`, #247): started from a bundle with a fresh
// data folder, the e2e init (no first run) and the repository's plugins, so its first layout is the
// Default profile's 13 plugin windows; headless unless `screen` (frames rendered off screen, so no
// screen, pointer or keyboard of the machine's is needed); with a frame trace. The shake and its
// captures are the shell's (`compositor_input { shake }`); a poke makes every page in sight paint.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { type CefDesk, dataDir, freePort, launchCef } from "../../support/cef.ts";
import { session, shell, targets, until } from "./devtools.ts";

export interface MotionDesk {
  /** Whether the desk's page came to rest before the shakes. */
  rested?: boolean;
  port: number;
  home: string;
  log: string;
  trace: string;
  desk: CefDesk;
}

export interface WindowAt {
  id: string;
  rect: number[];
  focused: boolean;
}

// biome-ignore lint/suspicious/noExplicitAny: compositor_stats is the shell's free-form JSON
export type Stats = any;

/** Start the desk under `home` (its data folder emptied first) and wait for its windows' pages. */
export async function startDesk(opts: {
  binary: string;
  root: string;
  home: string;
  log: string;
  trace: string;
  screen: boolean;
  windows: number;
}): Promise<MotionDesk> {
  const { binary, root, home, log, trace } = opts;
  rmSync(dataDir(home), { recursive: true, force: true });
  rmSync(trace, { force: true });
  mkdirSync(home, { recursive: true });
  // The terminal plugin's shell, quiet and the same each run.
  if (!existsSync(join(home, ".zshrc"))) writeFileSync(join(home, ".zshrc"), "PROMPT='%# '\n");
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(XDG_|DESK_)/.test(k)) env[k] = v;
  Object.assign(env, {
    HOME: home,
    DESK_PLUGIN_DIRS: join(root, "plugins"),
    DESK_INIT: join(root, "e2e/fixtures/init-no-first-run.yaml"),
    DESK_FRAME_TRACE: trace,
    ...(opts.screen ? {} : { DESK_COMPOSITOR_HEADLESS: "1" }),
  });
  const port = await freePort();
  const desk = await launchCef({ binary, env, log, home, port, timeoutMs: 90_000 });
  const run: MotionDesk = { port, home, log, trace, desk };
  // No OS focus comes to a headless window or under a locked screen: the desk is told it has it,
  // so its surfaces run at the front window's pace, as the app e2e does.
  await focus(port);
  const ready = await until(60_000, async () => {
    const stats: Stats = await shell(port, "compositor_stats");
    const windows = (stats.windows ?? []) as WindowAt[];
    const painted = windows.every((w) => stats.pages?.[`window:${w.id}`]?.texture);
    return windows.length >= opts.windows && painted;
  });
  if (!ready) {
    await stopDesk(run);
    throw new Error(`the desk's ${opts.windows} windows did not paint their pages within 60 s`);
  }
  // The desk's page paints every frame for its first seconds (the first layout's glides, Eris's
  // entrance): the shake waits until it rests, as a person's desk mostly is.
  run.rested = await rested(trace, 1_500, 45_000);
  return run;
}

/** Whether the desk's page painted nothing for `quiet` ms, within `ms`: the trace's attaches. */
async function rested(trace: string, quiet: number, ms: number): Promise<boolean> {
  const at = await until(ms, () => {
    const lines = readFileSync(trace, "utf8").split("\n");
    const start = lines.find((l) => l.includes('"e":"start"'));
    if (!start) return false;
    const now = Date.now() - (JSON.parse(start) as { f: { wallMs: number } }).f.wallMs;
    const paint = lines.findLast((l) => l.includes('"surface":"desk"') && l.includes('"attach"'));
    const last = paint ? (JSON.parse(paint) as { t: number }).t : 0;
    return now - last >= quiet;
  });
  return at === true;
}

/** Tell the desk its window has the OS focus. */
export const focus = (port: number) =>
  shell(port, "compositor_input", { events: [{ type: "windowFocused", focused: true }] });

/** The windows of the desktop in front, back to front, and the screen in logical pixels. */
export async function windows(port: number): Promise<{ screen: number[]; windows: WindowAt[] }> {
  const stats: Stats = await shell(port, "compositor_stats");
  const scale = ((await shell(port, "compositor_input_state")) as Stats).scale || 1;
  const [w = 0, h = 0] = stats.page?.texture ?? [];
  return { screen: [w / scale, h / scale], windows: stats.windows ?? [] };
}

/** Pointer events fed as winit's: a press at `from`, moves to `to`, a release. */
export async function drag(port: number, from: number[], to: number[]): Promise<void> {
  const [x0 = 0, y0 = 0] = from;
  const [x1 = 0, y1 = 0] = to;
  const moves = Array.from({ length: 10 }, (_, i) => ({
    type: "pointerMoved",
    x: x0 + ((x1 - x0) * (i + 1)) / 10,
    y: y0 + ((y1 - y0) * (i + 1)) / 10,
  }));
  const feed = (events: unknown[]) => shell(port, "compositor_input", { logical: true, events });
  await feed([{ type: "pointerMoved", x: x0, y: y0 }]);
  await feed([{ type: "pointerButton", button: "left", pressed: true }]);
  await delay(300);
  for (const move of moves) {
    await feed([move]);
    await delay(16);
  }
  await feed([{ type: "pointerButton", button: "left", pressed: false }]);
  await delay(800);
}

/** Run one shake and wait for its end in the trace. */
export async function shake(run: MotionDesk, args: Record<string, unknown>): Promise<void> {
  const done = () => (readFileSync(run.trace, "utf8").match(/"phase":"done"/g) ?? []).length;
  const before = done();
  await focus(run.port);
  await shell(run.port, "compositor_input", { shake: args });
  const wait = Number(args.durationMs ?? 3000) + 15_000;
  if (!(await until(wait, () => done() > before))) {
    throw new Error(`the shake ${String(args.tag)} did not end within ${wait / 1000} s`);
  }
}

/** Which surface a DevTools page target is: the desk's page, a window's page or a plugin's. */
function surfaceOf(t: { url: string; title: string }): string {
  if (t.url === "desk-app://app/index.html") return "desk";
  if (t.url.startsWith("desk-plugin://")) return new URL(t.url).host;
  if (t.title.startsWith("desk-window:")) return `window:${t.title.slice("desk-window:".length)}`;
  return "";
}

/** Each surface's paints so far, by surface. */
function paints(stats: Stats): Record<string, number> {
  const out: Record<string, number> = { desk: stats.page?.paints ?? 0 };
  for (const [k, v] of Object.entries<Stats>(stats.pages ?? {})) out[k] = v.counts?.paints ?? 0;
  for (const [k, v] of Object.entries<Stats>(stats.surfaces ?? {})) out[k] = v.counts?.paints ?? 0;
  return out;
}

const SHOWN = "Live { hidden: false }";
/** A two-pixel, all but clear touch of the page, gone two frames later: it paints twice. */
const TOUCH = `(() => { const d = document.createElement("div");
  d.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;background:rgba(127,127,127,0.02);pointer-events:none;z-index:2147483647";
  (document.body ?? document.documentElement).appendChild(d);
  requestAnimationFrame(() => requestAnimationFrame(() => d.remove())); return true; })()`;

/** Touch every page in sight (the desk's, each window's, each plugin's shown and awake) and say
 * which painted nothing within 1.5 s. */
export async function poke(port: number): Promise<{ poked: string[]; unpainted: string[] }> {
  const before: Stats = await shell(port, "compositor_stats");
  const shown = new Set<string>(["desk"]);
  for (const [k, v] of Object.entries<Stats>(before.pages ?? {}))
    if (v.state === SHOWN) shown.add(k);
  for (const [k, v] of Object.entries<Stats>(before.surfaces ?? {})) {
    if (v.state === SHOWN && !v.asleep && v.pieces?.length) shown.add(k);
  }
  const poked: string[] = [];
  for (const target of await targets(port)) {
    const surface = surfaceOf(target);
    if (target.type !== "page" || !shown.has(surface)) continue;
    const page = await session(target);
    try {
      await page.evaluate(TOUCH);
      poked.push(surface);
    } finally {
      page.close();
    }
  }
  const from = paints(before);
  await delay(1_500);
  const to = paints(await shell(port, "compositor_stats"));
  const unpainted = poked.filter((s) => (to[s] ?? 0) <= (from[s] ?? 0));
  return { poked, unpainted };
}

/** Quit the desk, then end whatever of it outlived it (a renderer helper reparented to launchd). */
export async function stopDesk(run: MotionDesk): Promise<void> {
  await run.desk.stop();
  try {
    const left = execFileSync("pgrep", ["-f", dataDir(run.home)], { encoding: "utf8" });
    for (const pid of left.split("\n").filter(Boolean)) process.kill(Number(pid), "SIGKILL");
  } catch {
    // Nothing left.
  }
}
