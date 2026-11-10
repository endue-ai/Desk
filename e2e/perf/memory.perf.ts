// Idle memory on the Default profile (fresh data folder, no dev plugin): the summed RSS of the app
// and its descendants five minutes after the app started, as `ps` reports it. The app is the process
// support/driver.ts started; its CEF helpers are under it.
import { execFileSync } from "node:child_process";
import { browser } from "@wdio/globals";
import { shellReady } from "../support/desk";
import { APP_STARTED_VAR, appPid } from "../support/driver";
import { type Proc, parsePs, rssMb, treeOf } from "./lib/memory";
import { measured } from "./support/out";

const AFTER_S = 300;

const ps = () =>
  parsePs(execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss=,comm="], { encoding: "utf8" }));

/** The app's process and how many seconds it has run. */
function theApp(procs: readonly Proc[]): { app: Proc; elapsed: number } {
  const pid = appPid();
  const app = procs.find((p) => p.pid === pid);
  if (!app) throw new Error(`no desk process (${pid})`);
  const started = Number(process.env[APP_STARTED_VAR]);
  return { app, elapsed: (Date.now() - started) / 1000 };
}

describe("idle memory: the Default profile five minutes after start", () => {
  it("sums the RSS of the app and its engine's processes", async () => {
    await shellReady();
    const { app, elapsed } = theApp(ps());
    await browser.pause(Math.max(0, AFTER_S - elapsed) * 1000);
    const tree = treeOf(ps(), app.pid);
    measured("memory", {
      idleMemory: {
        rssMb: rssMb(tree),
        afterMs: AFTER_S * 1000,
        processes: tree.map((p) => ({ pid: p.pid, name: p.name, rssMb: rssMb([p]) })),
      },
    });
  });
});
