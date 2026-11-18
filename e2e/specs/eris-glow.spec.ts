// A line to Eris lights the window in use (ADR 0271): she looks at it as the line comes in with
// the desk, and the compositor draws a glow in the star's colour just outside the window's frame
// until she has answered, then takes it away. The page only says which windows are lit (`lit` in
// its report); what shows is read back from the compositor's own frame. The specs' desk has no
// brain, and a turn with none waits, the window lit for as long: this one starts
// examples/brain-echo, which says the line back, and picks it in the rail.
import { type ChildProcess, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { $, browser, expect } from "@wdio/globals";
import { feed } from "../support/compositor";
import { MODE, press, shellReady, waitForData } from "../support/desk";
import { type Image, pixel, screenshot } from "../support/pixels";
import {
  deskNow,
  inUse,
  onScreen,
  type Rect,
  rectOf,
  run,
  until,
  type Window,
} from "../support/windows";

/** Where this spec's echo brain listens: `wdio.conf.ts` points the app's `DESK_ECHO_URL` there. */
const ECHO_PORT = 18787;
const SERVER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../examples/brain-echo/server.mjs",
);

/** Start examples/brain-echo; it says where it listens once it does. */
function startEcho(): Promise<ChildProcess> {
  const server = spawn(process.execPath, [SERVER, "--port", String(ECHO_PORT)], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((listening, failed) => {
    server.once("error", failed);
    server.once("exit", (code) => failed(new Error(`brain-echo ended with ${code}`)));
    server.stdout?.once("data", () => listening(server));
  });
}

/** What the rail says of the brain, and what Eris is doing. */
const brainSays = () =>
  browser.execute(
    () => document.querySelector("[data-key=rail-brain]")?.getAttribute("aria-label") ?? "",
  );
const erisIs = () =>
  browser.execute(() => document.querySelector<HTMLElement>(".eris")?.dataset.state ?? "");

/** The star's colour in the endue look (`packages/ui/src/tokens.ts`). */
const STAR = [0xb6, 0xa3, 0xf5];
const from = (c: number[]) => Math.hypot(...STAR.map((channel, i) => (c[i] ?? 0) - channel));

/** Say `text` to Eris on the talk line, as the keys would. */
const tell = (text: string) =>
  browser.execute((text: string) => {
    const input = document.querySelector<HTMLInputElement>("#composer-input");
    if (!input) return false;
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // The last choice says it to Eris.
    for (const key of ["ArrowUp", "Enter"])
      input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    return true;
  }, text);

/**
 * Points in the glow's rim, 1 CSS pixel outside `r`'s frame, along each of its edges: those in the
 * app that nothing in `over` covers (the windows in front of it, and where Eris stands and speaks).
 */
function rim(r: Rect, screen: { w: number; h: number }, over: Rect[]): { x: number; y: number }[] {
  const along = [0.2, 0.35, 0.5, 0.65, 0.8];
  const points = [
    ...along.map((t) => ({ x: r.x - 1, y: r.y + r.h * t })),
    ...along.map((t) => ({ x: r.x + r.w + 1, y: r.y + r.h * t })),
    ...along.map((t) => ({ x: r.x + r.w * t, y: r.y - 1 })),
    ...along.map((t) => ({ x: r.x + r.w * t, y: r.y + r.h + 1 })),
  ];
  const inside = (p: { x: number; y: number }, b: Rect) =>
    p.x >= b.x - 2 && p.x <= b.x + b.w + 2 && p.y >= b.y - 2 && p.y <= b.y + b.h + 2;
  return points
    .filter((p) => p.x >= 2 && p.y >= 2 && p.x < screen.w - 2 && p.y < screen.h - 2)
    .filter((p) => !over.some((b) => inside(p, b)));
}

/** How many of `points` are nearer the star's colour in `now` than they were in `before`. */
function nearer(before: Image, now: Image, points: { x: number; y: number }[]): number {
  const at = (img: Image, p: { x: number; y: number }) =>
    pixel(img, Math.round(p.x * img.scale), Math.round(p.y * img.scale)) ?? [0, 0, 0];
  return points.filter((p) => from(at(before, p)) - from(at(now, p)) > 12).length;
}

describe("eris: the window she looks at glows around its frame", () => {
  let echo: ChildProcess | undefined;

  before(async () => {
    echo = await startEcho();
    await shellReady();
    await feed([{ type: "windowFocused", focused: true }]);
    // The echo brain, picked in the rail as a person does (`persist.spec.ts`).
    const brains = `${MODE} [data-popover=brain]`;
    if (!(await $(brains).isExisting())) await press(`${MODE} [data-key=rail-brain]`);
    await press(`${brains} [data-key=brain-echo]`);
    type Settings = { desk?: Record<string, unknown> };
    const picked = (value: unknown) =>
      (value as Settings | undefined)?.desk?.["brain.use"] === "echo";
    await waitForData("settings.json", picked, "brain.use: echo under desk");
    await browser.waitUntil(async () => !(await brainSays()).includes("not connected"), {
      timeoutMsg: "the echo brain never connected",
    });
    if (await $(brains).isExisting()) await press(`${MODE} [data-key=rail-brain]`);
    // A window in use for her to look at: the first on the desktop in front, if none is.
    const desk = await deskNow();
    const first = onScreen(desk)[0];
    if (!inUse(desk) && first) await run("desk.windows.focus", { window: first.id });
    await until((d) => inUse(d) !== undefined, "no window came into use");
  });

  after(() => {
    echo?.kill();
  });

  it("lights the window in use in the star's colour while her look is out, and no longer after", async () => {
    const desk = await deskNow();
    const used = inUse(desk) as Window | undefined;
    if (!used) throw new Error("the desk has no window in use");
    const rank = used.z ?? 0;
    const over = onScreen(desk)
      .filter((w) => w.id !== used.id && (w.z ?? 0) > rank)
      .map(rectOf);
    // She comes out above the talk pill and speaks there: her words are no glow.
    const pill = await browser.execute(() => {
      const r = document.querySelector(".talk-pill")?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
    });
    if (pill) over.push({ x: pill.x - 80, y: pill.y - 280, w: pill.w + 160, h: pill.h + 280 });
    const points = rim(rectOf(used), desk.screen, over);
    expect(points.length).toBeGreaterThanOrEqual(5);
    const before = await screenshot(desk.screen.w);
    // Nothing is lit at rest: the same pixels a moment later are as they were.
    expect(nearer(before, await screenshot(desk.screen.w), points)).toBe(0);

    expect(await tell("what is this window")).toBe(true);
    let lit = 0;
    await browser.waitUntil(
      async () => {
        lit = nearer(before, await screenshot(desk.screen.w), points);
        return lit >= points.length / 2;
      },
      {
        timeout: 4_000,
        interval: 20,
        timeoutMsg: `the rim never took the star's colour: ${lit} of ${points.length} points`,
      },
    );

    // The echo says the line back; her look is home within two legs of 640 ms after it went out,
    // and the glow goes over 480 ms.
    await browser.waitUntil(async () => (await erisIs()) !== "thinking", {
      timeout: 15_000,
      timeoutMsg: "Eris never answered",
    });
    await browser.pause(2_400);
    expect(nearer(before, await screenshot(desk.screen.w), points)).toBe(0);
    // The page's part: its window's section is no longer marked either.
    const marked = await browser.execute(
      () => document.querySelectorAll(".errand, .errand-thread").length,
    );
    expect(marked).toBe(0);
  });
});
