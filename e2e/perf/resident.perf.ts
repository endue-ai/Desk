// endue at rest with no window (#237, ADR 0225): the Default profile, its main window closed with
// its red button (the desk runs on, the island over other apps), left alone twenty seconds, then
// measured for thirty with `ps`: the app's own process's CPU as a share of one core, its whole
// tree's, and the tree's summed RSS at the end, by kind of process beside it (#312). The app is the process support/driver.ts started.
// The window is closed through the shell's development command, as hidden.perf.ts closes it.
import { execFileSync } from "node:child_process";
import { loadavg } from "node:os";
import { browser } from "@wdio/globals";
import { shellCommand } from "../support/compositor";
import { shellReady } from "../support/desk";
import { appPid } from "../support/driver";
import { cpuPercent, parseCpu } from "./lib/cpu";
import { kinds, parsePs, rssMb, treeOf } from "./lib/memory";
import { round1 } from "./lib/stats";
import { measured } from "./support/out";

const SETTLE_MS = 20_000;
const WINDOW_MS = 30_000;

const cpu = () =>
  parseCpu(execFileSync("ps", ["-A", "-o", "pid=,ppid=,time=,comm="], { encoding: "utf8" }));
// The whole command line, so each helper's kind (its --type) is known (#312).
const memory = () =>
  parsePs(execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss=,command="], { encoding: "utf8" }));

describe("endue at rest with no window", () => {
  it("costs its own process under a share of a core, and its tree a known memory", async () => {
    await shellReady();
    const pid = appPid();
    if (!pid) throw new Error("no desk process");
    await shellCommand("compositor_window", { to: "closed" });
    await browser.pause(SETTLE_MS);
    const [before, start] = [cpu(), Date.now()];
    // No look at the desk meanwhile: a DevTools call would be work of its own.
    await new Promise((done) => setTimeout(done, WINDOW_MS));
    const seconds = (Date.now() - start) / 1000;
    const { app, tree } = cpuPercent(before, cpu(), pid, seconds);
    const procs = treeOf(memory(), pid);
    const seen = await shellCommand<{ main: boolean; island: boolean }>("compositor_window", {
      seen: true,
    });
    if (seen.main) throw new Error("the main window showed while it was measured closed");
    measured("resident", {
      residentAtRest: {
        cpuPercent: app,
        treePercent: tree,
        rssMb: rssMb(procs),
        processes: procs.length,
        kinds: kinds(procs),
        island: seen.island,
        loadAverage: round1(loadavg()[0] ?? 0),
        settleMs: SETTLE_MS,
        windowMs: WINDOW_MS,
        platform: `${process.platform}-${process.arch}`,
      },
    });
  });
});
