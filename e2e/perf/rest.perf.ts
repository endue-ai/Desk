// A fresh desk at rest (#134): the Default profile with its first run, gone through as a person who
// wants the desk soon does it (Skip for now, Later, Not now, a name, the first suggested task), then
// left alone: the app's own process's CPU, as a share of one core, and its whole tree's, over ten
// seconds once twenty have passed. The app is the process support/driver.ts started.
//
// The walk (#147): a window can go between the list of windows and the switch to it (a surface put to
// sleep, the first run closing), so a window that is gone is passed over, and the first run has
// ended once its window is gone from two looks in a row. A name is typed only where the first run
// asks for one: a task or a layout's name waits for its buttons, which come 0.6 s after the field,
// so the walk never takes the path a typed task takes (endue's brain, which the e2e desk has not).
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
/** Between two steps of the walk. */
const STEP_MS = 1000;

const ps = () =>
  parseCpu(execFileSync("ps", ["-A", "-o", "pid=,ppid=,time=,comm="], { encoding: "utf8" }));

/** Switch to `handle`; false when that window is gone. */
const switched = (handle: string) =>
  browser.switchToWindow(handle).then(
    () => true,
    () => false,
  );

/**
 * The first run's own window (an off-screen surface of its own), switched to, if it is open; else
 * back on `shell`'s window.
 */
async function firstRun(shell: string): Promise<string | undefined> {
  for (const handle of await browser.getWindowHandles()) {
    if (handle === shell || !(await switched(handle))) continue;
    const url = await browser.getUrl().catch(() => "");
    if (url.includes("/endue.onboarding/")) return handle;
  }
  await browser.switchToWindow(shell);
  return undefined;
}

/** What a step saw and did: the first run's scene, the buttons it showed, the one pressed. */
interface Step {
  scene: string;
  shown: string[];
  answer: string;
}

/** One step of the first run: the answer a person in a hurry gives to what it shows now. */
function step(): Step {
  const scene = document.documentElement.dataset.scene ?? "";
  const shown = [...document.querySelectorAll("button")].filter(
    (b) => !b.closest("[hidden]") && (b as HTMLElement).offsetParent && !b.disabled,
  );
  const labels = shown.map((b) => b.textContent?.trim() ?? "");
  const field = [...document.querySelectorAll("input[type=text]")].find(
    (i) => (i as HTMLElement).offsetParent,
  ) as HTMLInputElement | undefined;
  const naming = scene === "name";
  if (naming && field && !field.value) {
    field.value = "Probe";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const answers = ["Plan my week", "Later", "Skip for now", "Not now", "Leave it"];
  for (const answer of naming ? [...answers, "Send"] : answers) {
    const button = shown.find((b) => b.textContent?.trim() === answer);
    if (button) {
      button.click();
      return { scene, shown: labels, answer };
    }
  }
  return { scene, shown: labels, answer: "" };
}

/** Go through the first run as a person in a hurry does, until its window is gone. */
async function walk(shell: string): Promise<void> {
  await browser.waitUntil(async () => (await firstRun(shell)) !== undefined, {
    timeout: 30_000,
    timeoutMsg: "no first run opened",
  });
  const until = Date.now() + FIRST_RUN_MS;
  let last: Step | undefined;
  let gone = 0;
  while (gone < 2) {
    if (Date.now() > until) {
      throw new Error(`the first run did not end: it last showed ${JSON.stringify(last)}`);
    }
    if (await firstRun(shell)) {
      gone = 0;
      last = (await browser.execute(step).catch(() => undefined)) ?? last;
      await browser.switchToWindow(shell);
    } else gone += 1;
    await browser.pause(STEP_MS);
  }
}

describe("a fresh desk at rest: the first run gone through, then nothing", () => {
  it("costs its own process at most a few % of a core", async () => {
    await shellReady();
    await walk(await browser.getWindowHandle());
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
