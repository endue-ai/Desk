// Each window draws from a page of its own (#227, ADR 0201): the runtime lays every window out in a
// same-origin page the desk's page opens for it (`desk-window:<id>`), which the CEF shell renders
// off screen into a texture of its own and the compositor draws over the window's frame. The desk's
// page lays out no window, so nothing of a window is cut out of its picture: a window dragged at any
// speed shows only its own pixels and leaves nothing behind, and its page paints nothing for a move.
// Its title bar still moves it (and pans the canvas on Shift), and a press on a plugin's pane in it
// still makes it the window in use, as when the page held its DOM.
import { expect } from "@wdio/globals";
import { feed, shellCommand } from "../support/compositor";
import { shellReady } from "../support/desk";
import { bodyAt, drag, KEY, type Point, titleAt } from "../support/gestures";
import {
  clearDesk,
  closeShellWindows,
  deskNow,
  freshDesktop,
  inUse,
  onScreen,
  openWindow,
  panOf,
  run,
  windowNow,
} from "../support/windows";

const TERMINAL = "endue.terminal";

type Counts = { paints: number; texture: number[] | null } | null;
type Stats = { pages: Record<string, { counts: Counts; texture: number[] | null }> };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The ids of the windows the desk's page itself lays out: none once each has its own page. */
const inThePage = () =>
  browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>("section.surface[data-surface]")].map(
      (s) => s.dataset.surface ?? "",
    ),
  );

/** How window `id`'s own page holds its section: its style, and whether it fills the page (#270). */
const ownPageHolds = (id: string) =>
  browser.execute((id: string) => {
    const page = window.open("", `desk-window:${id}`);
    const section = page?.document.querySelector<HTMLElement>(
      `section.surface[data-surface="${CSS.escape(id)}"]`,
    );
    if (!page || !section) return null;
    const { left, top, width, height } = section.style;
    const r = section.getBoundingClientRect();
    const off = [r.x, r.y, r.width - page.innerWidth, r.height - page.innerHeight];
    return { style: [left, top, width, height], fills: off.every((d) => Math.abs(d) <= 1) };
  }, id);

/** What window `id`'s own page painted so far, and the texture the compositor holds of it. */
async function painted(id: string) {
  const { pages } = await shellCommand<Stats>("compositor_stats");
  const page = pages[`window:${id}`];
  return { paints: page?.counts?.paints ?? 0, texture: page?.texture ?? null };
}

/** A press at `p`, let go, through the compositor's input. */
async function press(p: Point): Promise<void> {
  const button = (pressed: boolean) => ({ type: "pointerButton", button: "left", pressed });
  await feed([{ type: "pointerMoved", x: Math.round(p.x), y: Math.round(p.y) }, button(true)]);
  await feed([button(false)]);
}

describe("window pages: each window draws from a page of its own (#227)", () => {
  before(async () => {
    await shellReady();
    await clearDesk([TERMINAL]);
  });
  beforeEach(async () => {
    await freshDesktop();
  });
  afterEach(async () => {
    await closeShellWindows();
  });

  it("the desk's page lays out no window, and each window's own page holds its section", async () => {
    const id = await openWindow();
    await pause(500);
    expect(await inThePage()).toEqual([]);
    // Sized by its page, not by its window's rect: the two never part for a frame.
    expect(await ownPageHolds(id)).toEqual({
      style: ["0px", "0px", "100vw", "100vh"],
      fills: true,
    });
    const { texture } = await painted(id);
    const win = await windowNow(id);
    const scale = await browser.execute(() => window.devicePixelRatio);
    expect(texture).toEqual([Math.round(win.w * scale), Math.round(win.h * scale)]);
  });

  it("a window dragged fast moves without its page painting, and lands where it is dropped", async () => {
    const id = await openWindow();
    await pause(800);
    const before = await windowNow(id);
    const from = titleAt(before, before.w / 2);
    const mid = { x: from.x + 40, y: from.y + 20 };
    // The press and the drag's start may change how the window looks (its state, its cursor).
    await drag(from, mid, { steps: 4, hold: true });
    let moved: number[];
    try {
      await pause(600);
      const { paints } = await painted(id);
      // Then 24 moves a frame apart, held: nothing the page lays out changes, the compositor draws
      // the same texture at each place.
      const to = { x: from.x + 260, y: from.y + 140 };
      for (let i = 1; i <= 24; i++) {
        const t = i / 24;
        const at = { x: mid.x + (to.x - mid.x) * t, y: mid.y + (to.y - mid.y) * t };
        await feed([{ type: "pointerMoved", x: Math.round(at.x), y: Math.round(at.y) }]);
        await pause(16);
      }
      await pause(400);
      moved = [paints, (await painted(id)).paints];
    } finally {
      await feed([{ type: "pointerButton", button: "left", pressed: false }]);
    }
    expect(moved[1]).toBe(moved[0]);
    await pause(600);
    const after = await windowNow(id);
    expect([after.x - before.x, after.y - before.y]).toEqual([260, 140]);
    expect([after.w, after.h]).toEqual([before.w, before.h]);
  });

  it("Shift on its title bar pans the canvas from its own page", async () => {
    const id = await openWindow();
    await pause(500);
    const win = await windowNow(id);
    const pan = panOf(await deskNow());
    const from = titleAt(win, win.w / 2);
    await drag(from, { x: from.x + 120, y: from.y + 60 }, { steps: 12, keys: [KEY.shift] });
    await pause(600);
    const now = panOf(await deskNow());
    expect([now.x - pan.x, now.y - pan.y]).toEqual([120, 60]);
  });

  it("a press on a plugin's pane makes its window the one in use, heard by its own page", async () => {
    await run("desk.plugins.open", { plugin: TERMINAL });
    await pause(800);
    const id = await openWindow();
    await pause(500);
    expect(inUse(await deskNow())?.id).toBe(id);
    const terminal = onScreen(await deskNow()).find((w) =>
      w.panes.some((p) => p.plugin === TERMINAL),
    );
    if (!terminal) throw new Error("Terminal's window is not on the desk");
    await press(bodyAt(terminal));
    await pause(500);
    expect(inUse(await deskNow())?.id).toBe(terminal.id);
    const { focused } = await shellCommand<{ focused: string | null }>("compositor_input_state");
    expect(focused).toBe("main.endue-terminal");
  });
});
