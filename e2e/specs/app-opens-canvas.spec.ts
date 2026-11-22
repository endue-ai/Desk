// An app opens on the canvas (#239, ADR 0226), on the CEF desk: examples/plugin-hello-window with
// `DESK_APP_WINDOWS=off`, which keeps every window on the canvas whatever its manifest says. Its
// window opens with a page of the 480 × 360 its manifest asks for, a resize stops at its smallest
// page (320 × 240), and it pops out into an OS window with the same page and its count. The twin
// of app-opens-out.spec.ts; the gestures go through the compositor's own input.
import { browser, expect } from "@wdio/globals";
import { shellCommand } from "../support/compositor";
import { shellReady } from "../support/desk";
import { click, drag, gripAt, type Point } from "../support/gestures";
import {
  APP,
  appWindow,
  count,
  countTo,
  framed,
  LEAST,
  PAGE,
  pageIs,
} from "../support/hello-window";
import { rectOf, run } from "../support/windows";

type CanvasMap = { shows: boolean; folded?: boolean; outer?: [number, number, number, number] };
const canvasMap = async () =>
  (await shellCommand<{ wm: { map: CanvasMap } }>("compositor_stats")).wm.map;

/** Fold the minimap through its button when it covers the grip we want to drag. */
async function uncoverGrip(point: Point): Promise<void> {
  const map = await canvasMap();
  if (!map.shows || map.folded || !map.outer) return;
  const [x, y, width, height] = map.outer;
  if (point.x < x || point.y < y || point.x >= x + width || point.y >= y + height) return;
  await click({ x: x + width - 18, y: y + 18 });
  await browser.waitUntil(async () => (await canvasMap()).folded === true, {
    timeoutMsg: "the minimap did not fold away from the resize grip",
  });
}

describe("an app that opens on the canvas", () => {
  it("opens in a window of the canvas, its page as large as its manifest asks", async () => {
    await shellReady();
    const w = await appWindow((w) => !w.hidden, "has no window");
    expect(w.out).toBeUndefined();
    expect({ w: w.w, h: w.h }).toEqual(framed(PAGE));
    await pageIs(PAGE);
    await countTo(3);
  });

  it("stops a resize at the smallest page its manifest asks", async () => {
    await run("desk.display.show", { plugin: APP });
    const before = await appWindow((w) => w.focused === true, "not in use");
    const grip = gripAt(rectOf(before), "se");
    await uncoverGrip(grip);
    await drag(grip, { x: grip.x - 400, y: grip.y - 400 });
    const small = await appWindow((w) => w.w !== before.w, "was not resized");
    expect({ w: small.w, h: small.h }).toEqual(framed(LEAST));
    await pageIs(LEAST);
  });

  it("pops out into an OS window with the same page and its count", async () => {
    await run("desk.windows.pop-out", { window: APP });
    const out = await appWindow((w) => w.out !== undefined, "never popped out");
    expect(out.out).toBeDefined();
    expect(await count()).toBe("3");
  });
});
