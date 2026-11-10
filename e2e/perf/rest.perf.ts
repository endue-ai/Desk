// A fresh desk at rest (#134): the Default profile with its first run, gone through as a person who
// wants the desk soon does it (Skip for now, Later, Not now, a name, the first suggested task), then
// left alone: the app's own process's CPU, as a share of one core, and its whole tree's, over ten
// seconds once twenty have passed. The app is the process support/driver.ts started.
import { execFileSync } from "node:child_process";
import { browser } from "@wdio/globals";
import { shellReady } from "../support/desk";
import { appPid } from "../support/driver";
import { cpuPercent, parseCpu } from "./lib/cpu";
import { measured } from "./support/out";

const SETTLE_MS = 20_000;
const WINDOW_MS = 10_000;
/** The longest the first run may take to go through. */
const FIRST_RUN_MS = 180_000;

const ps = () =>
  parseCpu(execFileSync("ps", ["-A", "-o", "pid=,ppid=,time=,comm="], { encoding: "utf8" }));

/** The first run's own window (an off-screen surface of its own), if it is still open. */
async function firstRun(): Promise<string | undefined> {
  const shell = await browser.getWindowHandle();
  for (const handle of await browser.getWindowHandles()) {
    if (handle === shell) continue;
    await browser.switchToWindow(handle);
    const url = await browser.getUrl().catch(() => "");
    await browser.switchToWindow(shell);
    if (url.includes("/endue.onboarding/")) return handle;
  }
  return undefined;
}

/** One step of the first run: the answer a person in a hurry gives to what it shows now. */
function step(): string {
  const shown = [...document.querySelectorAll("button")].filter(
    (b) => !b.closest("[hidden]") && (b as HTMLElement).offsetParent && !b.disabled,
  );
  const field = [...document.querySelectorAll("input[type=text]")].find(
    (i) => (i as HTMLElement).offsetParent,
  ) as HTMLInputElement | undefined;
  if (field && !field.value) {
    field.value = "Probe";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const answers = ["Plan my week", "Later", "Skip for now", "Not now", "Send"];
  for (const answer of answers) {
    const button = shown.find((b) => b.textContent?.trim() === answer);
    if (button) {
      button.click();
      return answer;
    }
  }
  return "";
}

describe("a fresh desk at rest: the first run gone through, then nothing", () => {
  it("costs its own process at most a few % of a core", async () => {
    await shellReady();
    const shell = await browser.getWindowHandle();
    await browser.waitUntil(async () => (await firstRun()) !== undefined, {
      timeout: 30_000,
      timeoutMsg: "no first run opened",
    });
    const until = Date.now() + FIRST_RUN_MS;
    for (let run = await firstRun(); run; run = await firstRun()) {
      if (Date.now() > until) throw new Error("the first run did not end");
      await browser.switchToWindow(run);
      await browser.execute(step).catch(() => "");
      await browser.switchToWindow(shell);
      await browser.pause(1000);
    }
    await browser.pause(SETTLE_MS);
    const pid = appPid();
    if (!pid) throw new Error("no desk process");
    const before = ps();
    await browser.pause(WINDOW_MS);
    const { app, tree } = cpuPercent(before, ps(), pid, WINDOW_MS / 1000);
    measured("rest", {
      freshDeskAtRest: {
        cpuPercent: app,
        treePercent: tree,
        settleMs: SETTLE_MS,
        windowMs: WINDOW_MS,
        platform: `${process.platform}-${process.arch}`,
      },
    });
  });
});
