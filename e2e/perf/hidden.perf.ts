// A desk nobody can see (#155): the main window closed with its red button (it only hides, #583),
// then minimized, each for ten seconds once three have passed, then brought back as the Dock icon
// does it. Measured: the app's own process's CPU as a share of one core, the event loop's turns a
// second (`compositor_stats`' pump.turns), and from the window brought back to its first composed
// frame. The window goes out of sight through the CEF shell's development command
// `compositor_window` (`to`: what the red button, the minimize button and the Dock icon do). Where
// the OS says nothing of a window out of sight (a locked screen; X11 without a window manager), the
// spec feeds the shell the event the OS would have sent (`compositor_window { occluded }`, winit's
// `Occluded`) and keeps `told: false` beside the values: what it checks is the desk's own wait.
import { execFileSync } from "node:child_process";
import { browser } from "@wdio/globals";
import { shellCommand } from "../support/compositor";
import { shellReady } from "../support/desk";
import { appPid } from "../support/driver";
import { cpuPercent, parseCpu } from "./lib/cpu";
import { round1 } from "./lib/stats";
import { measured } from "./support/out";

/** The spin started within about 3 s of the window going out of sight. */
const SETTLE_MS = 3000;
const WINDOW_MS = 10_000;
/** How long the OS may take to say the window went out of sight, or came back. */
const TOLD_MS = 3000;
/** Between two looks at the desk's counts. */
const LOOK_MS = 25;

interface Stats {
  occluded: boolean;
  composed: number;
  presented: number;
  pump: { turns: number };
}

const stats = () => shellCommand<Stats>("compositor_stats");
const window = (args: Record<string, unknown>) => shellCommand("compositor_window", args);
const ps = () =>
  parseCpu(execFileSync("ps", ["-A", "-o", "pid=,ppid=,time=,comm="], { encoding: "utf8" }));

/** Whether `ok` answers true within `ms`. */
async function within(ms: number, ok: (stats: Stats) => boolean): Promise<boolean> {
  const until = Date.now() + ms;
  do {
    if (ok(await stats())) return true;
    await browser.pause(LOOK_MS);
  } while (Date.now() < until);
  return false;
}

/** What one way out of sight cost. */
interface Sight {
  cpuPercent: number | null;
  treePercent: number;
  turnsPerSecond: number;
  shownFrameMs: number | null;
  /** Whether the OS said the window went out of sight (else the spec said it). */
  told: boolean;
  /** Whether the window presented its first frame once back (a locked screen withholds them). */
  presented: boolean;
}

/** The main window put out of sight as `to` does, measured, and brought back. */
async function outOfSight(pid: number, to: "closed" | "minimized"): Promise<Sight> {
  await window({ to });
  const told = await within(TOLD_MS, (s) => s.occluded);
  if (!told) await window({ occluded: true });
  await browser.pause(SETTLE_MS);
  const first = await stats();
  const [before, start] = [ps(), Date.now()];
  await browser.pause(WINDOW_MS);
  const [after, end] = [ps(), Date.now()];
  const last = await stats();
  const seconds = (end - start) / 1000;
  const { app, tree } = cpuPercent(before, after, pid, seconds);
  // Brought back: one frame at once, with whatever changed meanwhile.
  const shown = Date.now();
  await window({ to: "front" });
  let since = shown;
  let drawn = told && (await within(TOLD_MS, (s) => !s.occluded && s.composed > last.composed));
  if (!drawn) {
    since = Date.now();
    await window({ occluded: false });
    drawn = await within(TOLD_MS, (s) => s.composed > last.composed);
  }
  const shownFrameMs = drawn ? Date.now() - since : null;
  const back = await stats();
  return {
    cpuPercent: app,
    treePercent: tree,
    turnsPerSecond: round1((last.pump.turns - first.pump.turns) / seconds),
    shownFrameMs,
    told,
    presented: back.presented > last.presented,
  };
}

/** The worse of `values`, or null when one is missing. */
const worst = (values: (number | null)[]) =>
  values.some((v) => v === null) ? null : Math.max(...(values as number[]));

describe("a desk out of sight: closed, then minimized", () => {
  it("lets its event loop wait and draws at once when shown again", async () => {
    await shellReady();
    const pid = appPid();
    if (!pid) throw new Error("no desk process");
    const closed = await outOfSight(pid, "closed");
    const minimized = await outOfSight(pid, "minimized");
    const both = [closed, minimized];
    measured("hidden", {
      deskOutOfSight: {
        cpuPercent: worst(both.map((s) => s.cpuPercent)),
        turnsPerSecond: worst(both.map((s) => s.turnsPerSecond)),
        shownFrameMs: worst(both.map((s) => s.shownFrameMs)),
        closed,
        minimized,
        settleMs: SETTLE_MS,
        windowMs: WINDOW_MS,
        platform: `${process.platform}-${process.arch}`,
      },
    });
    // A window that never draws again is no number to judge: it fails here.
    for (const [name, sight] of Object.entries({ closed, minimized })) {
      if (sight.shownFrameMs === null) {
        throw new Error(`${name}, then brought back: no frame within ${TOLD_MS} ms`);
      }
    }
  });
});
