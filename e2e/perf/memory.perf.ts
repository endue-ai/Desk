// Idle memory on the Default profile (fresh data folder, no dev plugin): the summed RSS of the app
// and its descendants (WebKit's web and network processes) five minutes after the app started, as
// `ps` reports it. The app is the process named like the binary under this spec's tauri-driver.
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { browser } from "@wdio/globals";
import { shellReady } from "../support/desk";
import { driverPid } from "../support/driver";
import { findUnder, parsePs, rssMb, treeOf } from "./lib/memory";
import { measured } from "./support/out";

const AFTER_S = 300;
/** `ps` shows at most 15 characters of a name. */
const APP = basename(process.env.DESK_APP ?? "endue-desk").slice(0, 15);

const ps = () =>
  parsePs(execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss=,comm="], { encoding: "utf8" }));

describe("idle memory: the Default profile five minutes after start", () => {
  it("sums the RSS of the app and WebKit's processes", async () => {
    await shellReady();
    const driver = driverPid();
    const app = driver === undefined ? undefined : findUnder(ps(), driver, APP);
    if (!app) throw new Error(`no ${APP} process under tauri-driver (${driver})`);
    const elapsed = Number(
      execFileSync("ps", ["-o", "etimes=", "-p", String(app.pid)], { encoding: "utf8" }).trim(),
    );
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
