// Snapping (ADR 0128, ADR 0132; #82), the twin of packages/runtime/e2e/shell-snap.spec.ts on the
// CEF desk: a window dragged by its title bar to one of the app's edges takes that half of the
// whole app, to a corner that quarter; it floats then, so a pan (Shift + drag) leaves it where it
// is, and dragging it out brings back its own size and mode. Windows are read through
// desk.windows.list; the pointer is WebDriver's (support/gestures.ts). The preview's place, which
// no rect lists, is read off the screen: inside the part it is drawn over what was there, outside
// nothing changed. The glide's own frames are not checked (#80 draws it on the compositor).
import { expect } from "@wdio/globals";
import type { BrainDeskFill } from "../../packages/bridge/src/generated";
import { shellReady } from "../support/desk";
import { drag, emptyAt, KEY, type Point, release, spot, titleAt, walk } from "../support/gestures";
import { decodePng, difference, settled } from "../support/pixels";
import {
  clearDesk,
  closeShellWindows,
  deskNow,
  freshDesktop,
  openWindow,
  partOf,
  type Rect,
  rectOf,
  windowNow,
  windowUntil,
} from "../support/windows";

/** Where the pointer goes for each part, 3 px inside the app's edges (2 at the top). */
const AIM: Record<string, (w: number, h: number) => Point> = {
  left: (_, h) => ({ x: 3, y: h / 2 }),
  right: (w, h) => ({ x: w - 3, y: h / 2 }),
  top: (w) => ({ x: w / 2, y: 2 }),
  bottom: (w, h) => ({ x: w / 2, y: h - 3 }),
  "top-left": () => ({ x: 3, y: 3 }),
  "top-right": (w) => ({ x: w - 3, y: 3 }),
  "bottom-left": (_, h) => ({ x: 3, y: h - 3 }),
  "bottom-right": (w, h) => ({ x: w - 3, y: h - 3 }),
};
const PARTS = Object.keys(AIM) as BrainDeskFill[];

/** Where a window held by its title at `grab` is while the pointer is at `at`. */
const held = (win: Rect, grab: Point, at: Point): Rect => ({
  ...win,
  x: win.x + at.x - grab.x,
  y: win.y + at.y - grab.y,
});

describe("snap: windows dragged to the app's edges and corners (#82)", () => {
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

  for (const part of PARTS) {
    it(`dragged to the ${part}, a window snaps there, floating, and a pan leaves it there`, async () => {
      const other = await openWindow();
      const id = await openWindow();
      const desk = await deskNow();
      const { w, h } = desk.screen;
      const win = await windowNow(id);
      expect(win.state).toBe("normal");
      const want = partOf(part, desk.screen);
      const before = await settled(w);
      const grab = titleAt(rectOf(win));
      const aim = AIM[part]?.(w, h) ?? grab;
      await drag(grab, aim, { hold: true });
      // Before the drop the preview is drawn over the part, and nowhere else.
      const during = await settled(w);
      const avoid = [rectOf(win), held(rectOf(win), grab, aim), rectOf(await windowNow(other))];
      const inside = spot(want, avoid, desk.screen);
      const outside = spot(want, avoid, desk.screen, true);
      expect(difference(during, inside, before, inside)).toBeGreaterThan(0.5);
      expect(difference(during, outside, before, outside)).toBe(0);
      await release();
      const snapped = await windowUntil(id, (x) => x.state === "snapped", "snapped");
      expect(snapped).toMatchObject({ fill: part, floating: true, ...want });
      // Shift + drag pans the canvas: the normal window moves, the snapped one does not. From the
      // empty canvas: a snapped title bar keeps clear of the top chips, which then lie over its
      // middle (the canvas spec pans from a title bar).
      const below = await windowNow(other);
      const from = emptyAt(await deskNow());
      await drag(from, { x: from.x - 90, y: from.y + 40 }, { keys: [KEY.shift] });
      const moved = await windowUntil(other, (x) => x.x !== below.x, "the canvas moved");
      expect(rectOf(moved)).toEqual({ ...rectOf(below), x: below.x - 90, y: below.y + 40 });
      expect(rectOf(await windowNow(id))).toEqual(want);
      const front = (await deskNow()).desktops?.find((d) => d.current);
      expect(front?.pan).toEqual({ x: -90, y: 40 });
    });
  }

  it("the preview follows the pointer from zone to zone, and Escape leaves the window where it was", async () => {
    const id = await openWindow();
    const desk = await deskNow();
    const { w, h } = desk.screen;
    const win = await windowNow(id);
    const before = await settled(w);
    const grab = titleAt(rectOf(win));
    const left = { x: 3, y: h / 2 };
    const up = { x: 3, y: 60 };
    const middle = { x: Math.round(w * 0.55), y: Math.round(h * 0.375) };
    const corner = { x: w - 3, y: h - 3 };
    // A spot in three quarters, clear of the window wherever the drag holds it.
    const avoid = [
      rectOf(win),
      ...[left, up, middle, corner].map((at) => held(rectOf(win), grab, at)),
    ];
    const spots = {
      a: spot(partOf("top-left", desk.screen), avoid, desk.screen),
      b: spot(partOf("bottom-left", desk.screen), avoid, desk.screen),
      c: spot(partOf("bottom-right", desk.screen), avoid, desk.screen),
    };
    const frames = await walk(grab, [left, up, middle, corner], { last: KEY.escape });
    // Each frame as the spots drawn over; the same state twice in a row counts once.
    const states: string[] = [];
    for (const png of frames) {
      const img = decodePng(png, w);
      const on = Object.entries(spots)
        .filter(([, r]) => difference(img, r, before, r) > 0.5)
        .map(([name]) => name)
        .join("");
      if (states.at(-1) !== on) states.push(on);
    }
    // The left half covers both left quarters, the top-left quarter one, the middle none, then the
    // bottom-right quarter: in that order, whatever the glides drew between them.
    const order = ["ab", "a", "", "c"];
    let at = 0;
    for (const state of states) if (state === order[at]) at++;
    expect({ states, reached: at }).toEqual({ states, reached: order.length });
    const back = await windowUntil(id, (x) => x.x === win.x, "back where it was");
    expect(rectOf(back)).toEqual(rectOf(win));
    expect(back.state).toBe("normal");
    expect(back.fill).toBeUndefined();
  });

  it("dropped short of an edge, a window stays where it was dropped", async () => {
    const id = await openWindow();
    const win = await windowNow(id);
    const grab = titleAt(rectOf(win));
    await drag(grab, { x: 60, y: 450 });
    const dropped = await windowUntil(id, (x) => x.x !== win.x, "moved");
    expect(dropped.state).toBe("normal");
    expect(dropped.fill).toBeUndefined();
    expect(dropped.x).toBe(win.x + 60 - grab.x);
    expect(dropped.y).toBe(win.y + 450 - grab.y);
  });

  it("dragged out of its snap, a window takes back its size and its mode, under the pointer", async () => {
    const id = await openWindow();
    const win = await windowNow(id);
    const desk = await deskNow();
    await drag(titleAt(rectOf(win)), { x: 3, y: 3 });
    const snapped = await windowUntil(id, (x) => x.fill === "top-left", "the top-left quarter");
    expect(rectOf(snapped)).toEqual(partOf("top-left", desk.screen));
    // Grabbed by its title and dropped in the middle of the desk: its own size, under the pointer.
    const drop = { x: 700, y: 500 };
    await drag(titleAt(rectOf(snapped)), drop);
    const back = await windowUntil(id, (x) => x.state === "normal", "normal again");
    expect({ w: back.w, h: back.h }).toEqual({ w: win.w, h: win.h });
    expect(back.x).toBeLessThan(drop.x);
    expect(back.x + back.w).toBeGreaterThan(drop.x);
    expect(back.y).toBeLessThan(drop.y);
    expect(back.y + 40).toBeGreaterThan(drop.y);
    expect(back.fill).toBeUndefined();
    // Normal again, it moves with the canvas.
    const from = emptyAt(await deskNow());
    await drag(from, { x: from.x - 100, y: from.y }, { keys: [KEY.shift] });
    const panned = await windowUntil(id, (x) => x.x !== back.x, "moved with the canvas");
    expect(rectOf(panned)).toEqual({ ...rectOf(back), x: back.x - 100 });
  });
});
