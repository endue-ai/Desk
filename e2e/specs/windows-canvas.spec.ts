// The canvas (#82), the twin of packages/runtime/e2e/shell-canvas.spec.ts on the CEF desk: resizing
// from every edge and corner, the pan (Shift + drag, the wheel) moving normal windows and leaving
// floating ones, Escape and a redraw during a pan, each desktop's own pan, and filling the app over
// a panned canvas. desk.windows.list gives every rect and each desktop's pan. Left with their
// runtime twins: the cursors and the text selection (windows-selection covers the selection), the
// app's own size changing, the shell never scrolling, the session's stored coordinates across a
// relaunch (session.spec.ts), and the canvas map and its Reset button (drawn by #54).
import { browser, expect } from "@wdio/globals";
import { shellReady } from "../support/desk";
import {
  bodyAt,
  chord,
  click,
  drag,
  emptyAt,
  type Grip,
  gripAt,
  KEY,
  release,
  titleAt,
  toolAt,
  wheel,
} from "../support/gestures";
import { difference, settled } from "../support/pixels";
import {
  clearDesk,
  closeShellWindows,
  deskNow,
  freshDesktop,
  front,
  openWindow,
  panOf,
  rectOf,
  run,
  windowNow,
  windowUntil,
} from "../support/windows";

const GRIPS: Grip[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

/** Shift + drag from the empty canvas by (`dx`, `dy`). */
async function pan(dx: number, dy: number): Promise<void> {
  const from = emptyAt(await deskNow());
  await drag(from, { x: from.x + dx, y: from.y + dy }, { keys: [KEY.shift] });
}

describe("canvas: resizing and the pan (#82)", () => {
  before(async () => {
    await shellReady();
    await clearDesk();
  });
  beforeEach(async () => {
    await freshDesktop();
  });
  afterEach(async () => {
    await release().catch(() => {});
    await closeShellWindows();
  });

  for (const grip of GRIPS) {
    it(`resizes from ${grip} with the opposite edges anchored`, async () => {
      const id = await openWindow();
      const win = await windowNow(id);
      const at = gripAt(rectOf(win), grip);
      await drag(at, { x: at.x - 40, y: at.y - 30 }, { steps: 5 });
      const w = grip.includes("w") ? 40 : grip.includes("e") ? -40 : 0;
      const h = grip.includes("n") ? 30 : grip.includes("s") ? -30 : 0;
      const want = {
        x: win.x - (grip.includes("w") ? 40 : 0),
        y: win.y - (grip.includes("n") ? 30 : 0),
        w: win.w + w,
        h: win.h + h,
      };
      const resized = await windowUntil(id, (x) => x.w !== win.w || x.h !== win.h, "resized");
      expect(rectOf(resized)).toEqual(want);
      expect(resized.state).toBe("normal");
    });
  }

  it("a normal window follows the pan, a floating one stays, and either mode keeps its place", async () => {
    const canvas = await openWindow();
    const before = await windowNow(canvas);
    const floating = await openWindow();
    const unfloated = await windowNow(floating);
    expect(unfloated.state).toBe("normal");
    await click(toolAt(rectOf(unfloated), "floating"));
    const fixed = await windowUntil(floating, (x) => x.state === "floating", "floating");
    expect(rectOf(fixed)).toEqual(rectOf(unfloated));
    // A plain drag on the canvas does not pan.
    const from = emptyAt(await deskNow());
    await drag(from, { x: from.x - 120, y: from.y + 60 });
    expect(panOf(await deskNow())).toEqual({ x: 0, y: 0 });
    expect(rectOf(await windowNow(canvas))).toEqual(rectOf(before));
    await pan(-120, 60);
    const moved = await windowUntil(canvas, (x) => x.x !== before.x, "moved with the canvas");
    expect(rectOf(moved)).toEqual({ ...rectOf(before), x: before.x - 120, y: before.y + 60 });
    expect(rectOf(await windowNow(floating))).toEqual(rectOf(fixed));
    expect(panOf(await deskNow())).toEqual({ x: -120, y: 60 });
    // Floated where it is now, the normal window keeps its place on screen.
    await click(toolAt(rectOf(fixed), "close"));
    await click(toolAt(rectOf(moved), "floating"));
    const floated = await windowUntil(canvas, (x) => x.state === "floating", "floating");
    expect(rectOf(floated)).toEqual(rectOf(moved));
  });

  it("a pan holds through a redraw, Escape cancels it, and each desktop keeps its own", async () => {
    const id = await openWindow();
    // The calendar draws a picture of its own, which a shifted copy of it does not match.
    await run("desk.shell.open-calendar");
    const win = await windowUntil(id, (x) => x.panes[0]?.view === "calendar", "shows Calendar");
    const { w } = (await deskNow()).screen;
    const start = await settled(w);
    const from = emptyAt(await deskNow());
    await drag(from, { x: from.x - 100, y: from.y - 50 }, { keys: [KEY.shift], hold: true });
    // Something redraws the desk meanwhile: the window is still drawn where the pan holds it.
    await run("desk.shell.soul-solemn");
    const held = { ...rectOf(win), x: win.x - 100, y: win.y - 50 };
    const during = await settled(w);
    // Its picture is where the pan holds it, not where it was.
    expect(difference(during, held, start, rectOf(win), { inset: 4 })).toBeLessThan(0.005);
    expect(difference(during, rectOf(win), start, rectOf(win), { inset: 4 })).toBeGreaterThan(0.1);
    await chord(KEY.escape);
    await release();
    await run("desk.shell.soul-wisp");
    expect(panOf(await deskNow())).toEqual({ x: 0, y: 0 });
    expect(rectOf(await windowNow(id))).toEqual(rectOf(win));
    await pan(-100, -50);
    const here = front(await deskNow()).id;
    await windowUntil(id, (x) => x.x === win.x - 100, "panned");
    await run("desk.shell.desktop-previous");
    const other = await deskNow();
    expect(front(other).id).not.toBe(here);
    await run("desk.shell.desktop-next");
    const back = await windowUntil(id, (x) => x.desktop === here, "back on its desktop");
    expect(rectOf(back)).toEqual(held);
    expect(panOf(await deskNow())).toEqual({ x: -100, y: -50 });
  });

  it("the wheel over a pane does not pan; over the canvas it does", async () => {
    const id = await openWindow();
    await run("desk.shell.open-notes");
    const win = await windowUntil(id, (x) => x.panes[0]?.view === "notes", "shows Notes");
    await wheel(bodyAt(rectOf(win)), 0, 120);
    await browser.pause(300);
    expect(panOf(await deskNow())).toEqual({ x: 0, y: 0 });
    await wheel(emptyAt(await deskNow()), 0, 120);
    await browser.waitUntil(async () => panOf(await deskNow()).y === -120, {
      timeoutMsg: "the wheel over the canvas did not pan it by 120",
    });
    expect(rectOf(await windowNow(id))).toEqual({ ...rectOf(win), y: win.y - 120 });
  });

  it("maximize and restore take the whole app over a panned canvas and come back to the same place", async () => {
    const id = await openWindow();
    const start = await windowNow(id);
    await pan(-100, -50);
    const before = await windowUntil(id, (x) => x.x !== start.x, "panned");
    const { screen } = await deskNow();
    await run("desk.display.maximize");
    const full = await windowUntil(id, (x) => x.state === "filled", "filling the app");
    expect(rectOf(full)).toEqual({ x: 0, y: 0, w: screen.w, h: screen.h });
    await run("desk.display.maximize");
    const back = await windowUntil(id, (x) => x.state === "normal", "normal again");
    expect(rectOf(back)).toEqual(rectOf(before));
  });

  it("Shift + drag on a title bar pans the canvas instead of moving the window", async () => {
    const id = await openWindow();
    const win = await windowNow(id);
    const from = titleAt(rectOf(win));
    await drag(from, { x: from.x + 80, y: from.y + 40 }, { keys: [KEY.shift] });
    const moved = await windowUntil(id, (x) => x.x !== win.x, "moved on screen");
    expect(rectOf(moved)).toEqual({ ...rectOf(win), x: win.x + 80, y: win.y + 40 });
    expect(panOf(await deskNow())).toEqual({ x: 80, y: 40 });
  });
});
