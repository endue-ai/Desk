// The desk's page keeps drawing (#157, ADR 0165): with Chromium's full pipeline (ADR 0157) a
// begin frame met by an animation on the compositor's thread (a popover closing, a window's title
// tool, a maximize) never ended, CEF sent no other, and the page stood still for good while its
// DOM went on: clicks, wheels and resizes that changed nothing on screen. Each step here runs on a
// desk ready for 15 s (the stall needed one about 11 s old), the pointer and the keys through the
// compositor's input, and after it the page's requestAnimationFrame must still call back. A
// window the OS does not show (a locked screen, a sleeping display) runs no frames at all, so the
// case is skipped there.
import { expect } from "@wdio/globals";
import { feed } from "../support/compositor";
import { shellReady } from "../support/desk";
import { chord, KEY, type Point, titleAt, toolAt } from "../support/gestures";
import {
  clearDesk,
  closeShellWindows,
  freshDesktop,
  openWindow,
  windowNow,
} from "../support/windows";

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
