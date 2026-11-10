// Idle memory on the Default profile (fresh data folder, no dev plugin): the summed RSS of the app
// and its descendants five minutes after the app started, as `ps` reports it. On CEF the app is the
// process support/driver.ts started (its CEF helpers are under it); on Tauri it is the process named
// like the binary under this spec's tauri-driver (WebKit's web and network processes under it).
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { browser } from "@wdio/globals";
import { shellReady } from "../support/desk";
import { APP_STARTED_VAR, appPid, driverPid, SHELL } from "../support/driver";
import { findUnder, type Proc, parsePs, rssMb, treeOf } from "./lib/memory";
import { measured } from "./support/out";

const AFTER_S = 300;
/** `ps` shows at most 15 characters of a name on Linux. */
const APP = basename(process.env.DESK_APP ?? "endue-desk").slice(0, 15);

const ps = () =>
  parsePs(execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss=,comm="], { encoding: "utf8" }));

/** The app's process and how many seconds it has run. */
function theApp(procs: readonly Proc[]): { app: Proc; elapsed: number } {
  if (SHELL === "cef") {
    const pid = appPid();
    const app = procs.find((p) => p.pid === pid);
    if (!app) throw new Error(`no CEF desk process (${pid})`);
    const started = Number(process.env[APP_STARTED_VAR]);
    return { app, elapsed: (Date.now() - started) / 1000 };
  }
  const driver = driverPid();
  const app = driver === undefined ? undefined : findUnder(procs, driver, APP);
  if (!app) {
    const under = driver === undefined ? [] : treeOf(procs, driver).map((p) => p.name);
    throw new Error(`no ${APP} process under tauri-driver (${driver}): ${under.join(", ")}`);
  }
  const elapsed = Number(
    execFileSync("ps", ["-o", "etimes=", "-p", String(app.pid)], { encoding: "utf8" }).trim(),
  );
  return { app, elapsed };
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
