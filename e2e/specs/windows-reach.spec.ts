// What the pointer can always take again (#159 findings 4, 7, 11 and 13) on the CEF desk: a window's
// title bar after a drop on the dock, a drag that leaves the app from an edge's snap band, and the
// move commands; a drag right after a click, which is no double-click; and the cursor over the
// grips and the title bar, read from the compositor's input state (a real pointer's cursor on a
// screen is a person's check). Drags are the compositor's own input (support/gestures.ts), windows
// are read through desk.windows.list, the dock's box from the page that lays it out.
import { browser, expect } from "@wdio/globals";
import { feed, inputState } from "../support/compositor";
import { shellReady } from "../support/desk";
import { drag, gripAt, release, TITLE_BAR, titleAt } from "../support/gestures";
import {
  clearDesk,
  closeShellWindows,
  deskNow,
  freshDesktop,
  openWindow,
  type Rect,
  rectOf,
  run,
  type Window,
  windowNow,
  windowUntil,
} from "../support/windows";

/** A title bar's top to its bottom line. */
const BAR = TITLE_BAR + 1;
/** A title bar's tools, from the window's right edge: what does not drag it. */
const TOOLS = 171;
/** How much of the stretch that drags a window stays in sight at the app's sides. */
const GRAB = 48;
/** Longer than a window's glide into reach (`--motion-base`, 220 ms). */
const GLIDE = 600;

/** Whether window `w` has its title bar where the pointer can take it on a `screen` app. */
function reachable(w: Rect, screen: { w: number; h: number }): boolean {
  const stretch = w.w - TOOLS;
  return w.y >= 0 && w.y + BAR <= screen.h && w.x + stretch >= GRAB && w.x <= screen.w - GRAB;
}

/** The dock's box, as the page lays its surface out along the bottom edge. */
const dockBox = () =>
  browser.execute(() => {
    const r = document.querySelector("[data-surface-host*='endue-dock']")?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  });

/** The pointer at `at`, and what the window shows there. */
async function cursorAt(at: { x: number; y: number }): Promise<string> {
  await feed([{ type: "pointerMoved", x: Math.round(at.x), y: Math.round(at.y) }]);
  return (await inputState()).cursor;
}

describe("reach: a window's title bar stays where the pointer can take it (#159)", () => {
  before(async () => {
    await shellReady();
    await clearDesk();
    await browser.waitUntil(async () => (await dockBox()) !== null, {
      timeoutMsg: "the dock never showed",
    });
  });
  beforeEach(async () => {
    await freshDesktop();
  });
  afterEach(async () => {
    await release().catch(() => {});
    await closeShellWindows();
  });

  it("dropped with its title bar on the dock, a window ends above the dock and is taken again", async () => {
    const id = await openWindow();
    const win = await windowNow(id);
    const dock = await dockBox();
    if (!dock) throw new Error("no dock");
    const { h } = (await deskNow()).screen;
    const grab = titleAt(rectOf(win));
    // The pointer let go on the dock's tiles, short of the bottom edge's snap band.
    const drop = { x: grab.x, y: Math.min(dock.y + 25, h - 40) };
    await drag(grab, drop);
    const dropped = await windowUntil(id, (x) => x.y !== win.y, "dropped");
    expect(dropped.y + BAR).toBeLessThanOrEqual(Math.ceil(dock.y));
    expect(dropped.y + BAR).toBeGreaterThan(dock.y - 2);
    expect(dropped.fill).toBeUndefined();
    // Taken again by its title bar, where it is drawn once it glided there from the drop.
    await browser.pause(GLIDE);
    const from = titleAt(rectOf(dropped));
    await drag(from, { x: from.x, y: 300 });
    const back = await windowUntil(id, (x) => x.y !== dropped.y, "taken again");
    expect(back.y).toBe(dropped.y + 300 - from.y);
  });

  it("dragged from an edge's snap band far out of the app, a window keeps its title bar in it", async () => {
    const { w, h } = (await deskNow()).screen;
    // To the left and the right: first to the edge, then from inside its band 600 px beyond it.
    const sides = [
      { edge: 30, band: 10, out: -600 },
      { edge: w - 30, band: w - 10, out: w + 600 },
    ];
    for (const side of sides) {
      const id = await openWindow();
      const win = await windowNow(id);
      const grab = titleAt(rectOf(win));
      await drag(grab, { x: side.edge, y: grab.y });
      const there = await windowUntil(id, (x) => x.x !== win.x, "at the edge");
      await drag({ x: side.band, y: grab.y }, { x: side.out, y: grab.y }, { steps: 20 });
      const out = await windowUntil(id, (x) => x.x !== there.x, "let go beyond the edge");
      expect({ reachable: reachable(rectOf(out), { w, h }), out }).toMatchObject({
        reachable: true,
      });
      expect(out.fill).toBeUndefined();
    }
    // Up beyond the top it snaps to the top half (ADR 0128), its title bar in the app too.
    const id = await openWindow();
    const win = await windowNow(id);
    await drag(titleAt(rectOf(win)), { x: 600, y: -600 }, { steps: 20 });
    const up = await windowUntil(id, (x) => x.y !== win.y, "let go above the app");
    expect(reachable(rectOf(up), { w, h })).toBe(true);
  });

  it("thirty steps up and thirty to the left leave the title bar in the app", async () => {
    const id = await openWindow();
    const { w, h } = (await deskNow()).screen;
    for (let i = 0; i < 30; i++) await run("desk.display.move-up");
    const up = await windowUntil(id, (x) => x.y === 0, "at the top");
    expect(reachable(rectOf(up), { w, h })).toBe(true);
    for (let i = 0; i < 30; i++) await run("desk.display.move-left");
    const left = await windowUntil(id, (x) => x.x < 0, "past the left edge");
    expect(reachable(rectOf(left), { w, h })).toBe(true);
  });

  it("a click on a title, then at once a drag from there, leaves the window where it was dropped", async () => {
    const id = await openWindow();
    const win = await windowNow(id);
    const grab = titleAt(rectOf(win));
    const at = { type: "pointerMoved", x: grab.x, y: grab.y };
    const button = (pressed: boolean) => ({ type: "pointerButton", button: "left", pressed });
    await feed([at, button(true), button(false)]);
    // 200 ms later: the press counts as the second click of a double-click.
    await browser.pause(200);
    await drag(grab, { x: grab.x + 80, y: grab.y + 30 });
    const moved = await windowUntil(id, (x) => x.x !== win.x, "dropped");
    // The page's double-click on the title had time to ask for a maximize.
    await browser.pause(800);
    const after = await windowNow(id);
    expect(after.state).toBe("normal");
    expect(rectOf(after)).toEqual({ ...rectOf(win), x: win.x + 80, y: win.y + 30 });
    expect(rectOf(moved)).toEqual(rectOf(after));
    // A double-click with no drag still maximizes.
    const title = titleAt(rectOf(after));
    await feed([{ ...at, ...title }, button(true), button(false), button(true), button(false)]);
    await windowUntil(id, (x) => x.state === "filled", "maximized by a double-click");
  });

  it("over its grips a window shows the resize cursors, over its title a grab hand", async () => {
    const id = await openWindow();
    const win: Window = await windowNow(id);
    const r = rectOf(win);
    expect(await cursorAt(gripAt(r, "e"))).toContain("EwResize");
    expect(await cursorAt(gripAt(r, "w"))).toContain("EwResize");
    expect(await cursorAt(gripAt(r, "n"))).toContain("NsResize");
    expect(await cursorAt(gripAt(r, "s"))).toContain("NsResize");
    expect(await cursorAt(gripAt(r, "se"))).toContain("NwseResize");
    expect(await cursorAt(gripAt(r, "ne"))).toContain("NeswResize");
    expect(await cursorAt(titleAt(r))).toContain("Grab");
    const body = { x: r.x + r.w / 2, y: r.y + TITLE_BAR + 60 };
    expect(await cursorAt(body)).not.toMatch(/Resize|Grab/);
    // Held, a resize keeps its cursor wherever the pointer goes.
    const se = gripAt(r, "se");
    await drag(se, { x: se.x + 60, y: se.y + 40 }, { hold: true });
    expect(await cursorAt({ x: se.x + 70, y: se.y + 45 })).toContain("NwseResize");
    await release();
    await windowUntil(id, (x) => x.w !== win.w, "resized");
  });
});
