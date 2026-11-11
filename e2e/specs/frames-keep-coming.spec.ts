// The desk's page keeps drawing (#157, ADR 0165): with Chromium's full pipeline (ADR 0157) a
// begin frame met by an animation on the compositor's thread (a popover closing, a window's title
// tool, a maximize) never ended, CEF sent no other, and the page stood still for good while its
// DOM went on: clicks, wheels and resizes that changed nothing on screen. Each step here runs on a
// desk ready for 15 s (the stall needed one about 11 s old), the pointer and the keys through the
// compositor's input, and after it the page's requestAnimationFrame must still call back. A
// window the OS does not show (a locked screen, a sleeping display) runs no frames at all, so the
// case is skipped there. A plugin window's first maximize or snap stopped its page the same way
// (with the Mac's screen locked, in most tries, ADR XXXX): a resize told the page's browser the
// screen changed as well, which laid it out again past CEF's hold on a resize in flight, and after
// a glide's resizes CEF sent it no begin frame again; its texture stayed a few pixels short of its
// pane. Its page must draw after each gesture, at its pane's size, and the shell's watch for a page
// that stopped painting (`web_host/stall.rs`) must have found none.
import { expect } from "@wdio/globals";
import { feed, inSurface, shellCommand } from "../support/compositor";
import { shellReady } from "../support/desk";
import { chord, drag, gripAt, KEY, type Point, titleAt, toolAt } from "../support/gestures";
import {
  clearDesk,
  closeShellWindows,
  deskNow,
  freshDesktop,
  onScreen,
  openWindow,
  type Window,
  windowNow,
} from "../support/windows";

/** The plugin whose window the plugin case moves: Terminal, its surface's host. */
const TERMINAL = "endue.terminal";
const HOST = "main.endue-terminal";

/**
 * Frames the page's requestAnimationFrame runs in 600 ms; none when the page gives no answer in
 * 5 s (chromedriver's script waits on a page that stopped drawing).
 */
const frames = () =>
  Promise.race([
    browser.execute(
      () =>
        new Promise<number>((resolve) => {
          let n = 0;
          const start = performance.now();
          const tick = () => {
            n++;
            if (performance.now() - start < 600) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          setTimeout(() => resolve(n), 800);
        }),
    ),
    new Promise<number>((resolve) => setTimeout(() => resolve(0), 5_000)),
  ]);

/** A click (`count` 2: a double-click) through the compositor's input. */
async function press(p: Point, count = 1): Promise<void> {
  const button = (pressed: boolean) => ({ type: "pointerButton", button: "left", pressed });
  const clicks = Array.from({ length: count }, () => [button(true), button(false)]).flat();
  await feed([{ type: "pointerMoved", x: Math.round(p.x), y: Math.round(p.y) }, ...clicks]);
}

/** The middle of each of the rail's buttons. */
const railButtons = () =>
  browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>(".rail .rail-button")].map((b) => {
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }),
  );

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** After `step`, the page still runs its frames. */
async function stillDrawing(step: string): Promise<void> {
  await pause(500);
  const drawing = (await frames()) > 0;
  expect({ step, drawing }).toEqual({ step, drawing: true });
}

type Counts = { texture: number[] | null; stalls?: number } | null;
type Stats = {
  surfaces: Record<string, { rect: number[] | null; counts: Counts }>;
  page: { stalls?: number };
};

/** Frames plugin `host`'s page runs in 600 ms: none once it stopped drawing (its timers still run). */
const pageFrames = (host: string) =>
  inSurface<number>(
    host,
    `new Promise((resolve) => { let n = 0; const start = performance.now();
      const tick = () => { n++; if (performance.now() - start < 600) requestAnimationFrame(tick); };
      requestAnimationFrame(tick); setTimeout(() => resolve(n), 800); })`,
  );

/** The page's last texture and its pane's size, in pixels, and the stalls the shell's watch found. */
async function placed(host: string) {
  const { surfaces, page } = await shellCommand<Stats>("compositor_stats");
  const scale = await browser.execute(() => window.devicePixelRatio);
  const [, , w = 0, h = 0] = surfaces[host]?.rect ?? [];
  return {
    texture: surfaces[host]?.counts?.texture ?? null,
    pane: [Math.round(w * scale), Math.round(h * scale)],
    stalls: (surfaces[host]?.counts?.stalls ?? 0) + (page.stalls ?? 0),
  };
}

/** After `step`, the plugin's page still draws, at its pane's size. */
async function pageKeepsUp(step: string): Promise<void> {
  await pause(800);
  const drawing = (await pageFrames(HOST)) > 0;
  const { texture, pane } = await placed(HOST);
  const fits = (texture ?? []).every((px, i) => Math.abs(px - (pane[i] ?? 0)) <= 1);
  expect({ step, drawing, fits, texture, pane }).toEqual({
    step,
    drawing: true,
    fits: true,
    texture,
    pane,
  });
}

/** Terminal's window on the desktop in front. */
async function terminal(): Promise<Window> {
  const w = onScreen(await deskNow()).find((w) => w.panes.some((p) => p.plugin === TERMINAL));
  if (!w) throw new Error("Terminal's window is not on the desk");
  return w;
}

describe("frames: a plugin window's page never stops drawing (#157)", () => {
  before(async function () {
    await shellReady();
    await clearDesk([TERMINAL]);
    if ((await browser.execute(() => document.visibilityState)) !== "visible") this.skip();
    await terminal();
    await pause(15_000);
  });

  it("after each of ten maximizes and restores", async () => {
    for (let i = 1; i <= 10; i++) {
      for (const step of ["maximize", "restore"]) {
        const win = await terminal();
        await press(titleAt(win, win.w / 3), 2);
        await pageKeepsUp(`${step} ${i}`);
        const now = await terminal();
        expect({ step, resized: now.w !== win.w }).toEqual({ step, resized: true });
      }
    }
  });

  it("after a snap to the left half and back, and a corner resize in quick moves", async () => {
    const win = await terminal();
    await drag(titleAt(win, win.w / 3), { x: 2, y: 400 }, { steps: 16 });
    await pageKeepsUp("snap left");
    const snapped = await terminal();
    await drag(titleAt(snapped, snapped.w / 3), { x: 700, y: 300 }, { steps: 16 });
    await pageKeepsUp("unsnap");
    // Moves about 10 ms apart, as a hand's: such a resize stopped the page three times in four.
    const before = await terminal();
    const grip = gripAt(before, "se");
    const at = (i: number) => ({ x: Math.round(grip.x + i * 20), y: Math.round(grip.y + i * 12) });
    await feed([
      { type: "pointerMoved", ...at(0) },
      { type: "pointerButton", button: "left", pressed: true },
    ]);
    for (let i = 1; i <= 10; i++) {
      await feed([{ type: "pointerMoved", ...at(i) }]);
      await pause(10);
    }
    await feed([{ type: "pointerButton", button: "left", pressed: false }]);
    await pageKeepsUp("corner resize");
    expect((await terminal()).w).toBeGreaterThan(before.w);
    expect((await placed(HOST)).stalls).toBe(0);
  });
});

describe("frames: the desk's page never stops drawing (#157)", () => {
  before(async function () {
    await shellReady();
    await clearDesk();
    await freshDesktop();
    if ((await browser.execute(() => document.visibilityState)) !== "visible") this.skip();
    // The stall needed a desk about 11 s old.
    await pause(15_000);
  });
  after(async () => {
    await closeShellWindows();
  });

  it("after each of the rail's popovers, closed with Escape", async () => {
    const buttons = await railButtons();
    expect(buttons.length).toBeGreaterThan(2);
    for (const [i, at] of buttons.slice(0, 4).entries()) {
      await press(at);
      await pause(400);
      await chord(KEY.escape);
      await stillDrawing(`rail popover ${i + 1}`);
    }
  });

  it("after a window's Floating mode, there and back, and a maximize and restore", async () => {
    const id = await openWindow();
    const win = await windowNow(id);
    await press(toolAt(win, "floating"));
    await stillDrawing("floating on");
    await press(toolAt(await windowNow(id), "floating"));
    await stillDrawing("floating off");
    await press(titleAt(await windowNow(id)), 2);
    await stillDrawing("maximize");
    await press(titleAt(await windowNow(id)), 2);
    await stillDrawing("restore");
  });
});
