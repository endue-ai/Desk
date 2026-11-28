// Exercise a background start, live timers and agent notices, the global shortcuts, the login
// item and quitting with the main window closed (#237, ADR 0225). Use the shell's development
// command for shortcut actions so the tests do not send global keystrokes to the machine.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browser, expect } from "@wdio/globals";
import { cefBinary, closeBrowser } from "../support/cef";
import { shellCommand } from "../support/compositor";
import { MODE, shellReady } from "../support/desk";
import { appPid, HOME_VAR, loginItems } from "../support/driver";

interface Seen {
  main: boolean;
  palette: boolean;
}
interface Answer {
  result?: Record<string, unknown>;
  error?: { message: string };
}

const seen = () => shellCommand<Seen>("compositor_window", { seen: true });
const occluded = async () =>
  (await shellCommand<{ occluded: boolean }>("compositor_stats")).occluded;
const hidden = () => browser.execute(() => document.hidden);

/** The built-in plugin the run is reported as: it holds `ui:notify`, as a plugin that runs agents does. */
const REPORTER = "endue.terminal";

/** One bridge call as plugin `REPORTER`, through the desk's own page, which hosts it. */
async function bridge(method: string, params: Record<string, unknown>): Promise<Answer> {
  const request = { id: 1, method, params };
  const answer = await shellCommand<Answer>("bridge_call", { request, caller: REPORTER });
  if (answer.error) throw new Error(`${method}: ${answer.error.message}`);
  return answer;
}

/**
 * Forty steps on the desk's page's own timers, 10 ms apart: how long they took, in ms. The page
 * keeps the time under `name` and the spec looks for it: a script that waits in a hidden page is
 * not one chromedriver answers.
 */
async function count(name: string): Promise<number> {
  await browser.execute((name: string) => {
    const start = performance.now();
    let left = 40;
    const step = () => {
      if (--left > 0) setTimeout(step, 10);
      else (window as unknown as Record<string, number>)[name] = performance.now() - start;
    };
    setTimeout(step, 10);
  }, `counted-${name}`);
  let took: number | null = null;
  await browser.waitUntil(
    async () => {
      took = await browser.execute(
        (name: string) => (window as unknown as Record<string, number | undefined>)[name] ?? null,
        `counted-${name}`,
      );
      return took !== null;
    },
    { timeout: 45_000, interval: 250, timeoutMsg: "forty timers of 10 ms did not end in 45 s" },
  );
  return took ?? Number.POSITIVE_INFINITY;
}

/** The pids of `pid` and every process under it that still run. */
function tree(pid: number): number[] {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((row) => row.length === 2 && row.every(Number.isInteger)) as [number, number][];
  const found = rows.some(([p]) => p === pid) ? [pid] : [];
  for (const parent of found) {
    found.push(...rows.filter(([p, pp]) => pp === parent && !found.includes(p)).map(([p]) => p));
  }
  return found;
}

describe("endue with every window closed", () => {
  before(async () => {
    await shellReady();
  });

  it("started by its login item, is ready with no window, and what waits on frames has ended", async () => {
    expect(await seen()).toEqual({ main: false, palette: false });
    expect(await shellCommand("compositor_window", { frame: true })).toBeNull();
    expect(await occluded()).toBe(true);
    expect(await hidden()).toBe(true);
    // The ready line fades in on the runtime's clock: a hidden page gets no animation frame.
    await browser.waitUntil(
      () =>
        browser.execute(
          (s: string) => (document.querySelector(s) as HTMLElement | null)?.style.opacity === "1",
          `${MODE} footer.desk-status`,
        ),
      { timeout: 5000, timeoutMsg: "the ready line's fade never ended on the hidden page" },
    );
  });

  it("keeps its hidden page's timers at their own pace", async () => {
    expect(await hidden()).toBe(true);
    // Chromium lets a hidden page's timers run once a second: forty of 10 ms would take 40 s.
    const ms = await count("timers");
    expect(ms).toBeLessThan(5000);
  });

  it("finishes a run behind closed windows and updates its status line", async () => {
    expect(await seen()).toEqual({ main: false, palette: false });
    const run = {
      id: "run-resident",
      agent: { id: "probe", name: "Probe" },
      title: "Count to forty",
      startedAt: new Date().toISOString(),
    };
    await bridge("agent.report", { ...run, state: "running" });
    // The work is the hidden page's own: forty steps on its timers, then the run's end.
    expect(await count("run")).toBeLessThan(5000);
    await bridge("agent.report", {
      ...run,
      state: "done",
      endedAt: new Date().toISOString(),
      result: "forty",
    });
    await bridge("ui.notify", {
      title: "Probe counted to forty",
      level: "success",
      scope: { permission: "ui:notify" },
    });
    await browser.waitUntil(
      () =>
        browser.execute(
          (selector: string) =>
            document.querySelector(selector)?.textContent === "Probe counted to forty",
          `${MODE} footer.desk-status`,
        ),
      { timeoutMsg: "the notice never reached the status line" },
    );
    expect(await seen()).toEqual({ main: false, palette: false });
  });

  it("summons Search Desk in the background and brings Desk forward to talk to Eris", async () => {
    const shortcut = (action: string) =>
      shellCommand<Seen>("compositor_window", { shortcut: action });
    expect(await shortcut("search")).toEqual({ main: false, palette: true });
    expect(await shortcut("eris")).toEqual({ main: true, palette: false });
    await browser.waitUntil(
      () => browser.execute(() => Boolean(document.querySelector('.talk-pill[data-state="edit"]'))),
      { timeoutMsg: "Eris's talk line did not open" },
    );
  });

  it("writes the login item the setting asks for, which starts this desk in the background", async () => {
    const home = process.env[HOME_VAR] ?? "";
    const plist = join(loginItems(home), "ai.endue.desktop.plist");
    await browser.waitUntil(() => existsSync(plist), {
      timeoutMsg: `no login item at ${plist}`,
    });
    const text = readFileSync(plist, "utf8");
    const app = cefBinary(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
    expect(text).toContain(`<string>${app}</string>`);
    expect(text).toContain("<string>--background</string>");
    expect(text).toContain("<key>RunAtLoad</key>");
  });

  it("shows its window when asked and runs on when it closes again", async () => {
    await shellCommand("compositor_window", { to: "front" });
    expect(await seen()).toMatchObject({ main: true });
    expect(await occluded()).toBe(false);
    await browser.waitUntil(async () => !(await hidden()), {
      timeoutMsg: "the desk's page stayed hidden in a window that shows",
    });
    await shellCommand("compositor_window", { to: "closed" });
    expect(await seen()).toEqual({ main: false, palette: false });
    expect(await occluded()).toBe(true);
    await browser.waitUntil(hidden, { timeoutMsg: "the closed desk's page still shows" });
    expect(tree(appPid() ?? 0).length).toBeGreaterThan(1);
  });

  /** Wait until none of `pids` runs, 20 s at most; those that still do. */
  async function gone(pids: number[]): Promise<number[]> {
    const alive = () => pids.filter((p) => tree(p).length > 0);
    const until = Date.now() + 20_000;
    while (alive().length > 0 && Date.now() < until) {
      await new Promise((done) => setTimeout(done, 250));
    }
    return alive();
  }

  it("quits from the menu with every window closed, and every process ends", async function () {
    // Browser.close reaches the menu's Quit by `terminate:`, which is macOS's (`run_event.rs`).
    if (process.platform !== "darwin") this.skip();
    const before = tree(appPid() ?? 0);
    expect(before.length).toBeGreaterThan(1);
    expect(await seen()).toEqual({ main: false, palette: false });
    const at = (
      browser.requestedCapabilities as { "goog:chromeOptions"?: { debuggerAddress?: string } }
    )["goog:chromeOptions"]?.debuggerAddress;
    expect(await closeBrowser(Number(at?.split(":")[1]))).toBe(true);
    expect(await gone(before)).toEqual([]);
  });
});
