// What the desk opens over its windows (#158, #161, ADR XXXX): a dialog, the desktops' overview and
// the settings are drawn whole above every window, the dock, Eris and the canvas map, and a modal's
// scrim dims all of them, the windows' titles and bodies included, which the page's own scrim never
// reached; a press outside the dialog is the dialog's, never a window's. What the screen shows is
// the compositor's composed frame (`compositor_capture`), what the page draws its own screenshot;
// both are read at the middle of each CSS pixel, whatever the screen's scale.
import { browser, expect } from "@wdio/globals";
import { feed, inputState, keyPress, shellCommand } from "../support/compositor";
import { shellReady } from "../support/desk";
import { decodePng, type Image, pixel, settled } from "../support/pixels";
import { deskNow, onScreen, type Rect, run } from "../support/windows";

/** The page's box of the first element `selector` finds, once it shows. */
async function boxOf(selector: string): Promise<Rect> {
  let box: Rect | null = null;
  await browser.waitUntil(
    async () => {
      box = await browser.execute((selector: string) => {
        const r = document.querySelector(selector)?.getBoundingClientRect();
        return r && r.width > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
      }, selector);
      return box !== null;
    },
    { timeoutMsg: `${selector} never showed` },
  );
  return box as unknown as Rect;
}

const gone = (selector: string) =>
  browser.waitUntil(
    () => browser.execute((s: string) => document.querySelector(s) === null, selector),
    { timeoutMsg: `${selector} never closed` },
  );

/** The page's own pixels: the desk's page alone, without the windows the compositor draws. */
const pageShot = async (width: number) =>
  decodePng(Buffer.from(await browser.takeScreenshot(), "base64"), width);

/** The colour at the middle of CSS pixel (x, y). */
const at = (img: Image, x: number, y: number) =>
  pixel(img, Math.floor((x + 0.5) * img.scale), Math.floor((y + 0.5) * img.scale));

const grow = (r: Rect, by: number): Rect => ({
  x: r.x - by,
  y: r.y - by,
  w: r.w + 2 * by,
  h: r.h + 2 * by,
});
const inside = (r: Rect, x: number, y: number) =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** The share of `r`'s CSS pixels whose colour in `a` and `b` differs by more than `tolerance`. */
function differing(a: Image, b: Image, r: Rect, tolerance = 24): number {
  let counted = 0;
  let differ = 0;
  for (let y = Math.ceil(r.y); y < r.y + r.h; y++) {
    for (let x = Math.ceil(r.x); x < r.x + r.w; x++) {
      const [pa, pb] = [at(a, x, y), at(b, x, y)];
      if (!pa || !pb) continue;
      counted++;
      if (pa.some((c, i) => Math.abs(c - (pb[i] ?? 0)) > tolerance)) differ++;
    }
  }
  if (!counted) throw new Error("nothing to compare");
  return differ / counted;
}

/**
 * Of what was bright before (a window's title, its text, the map's frame, the dock's tiles), the
 * share outside `keep` that is about as bright after: a scrim over it leaves none.
 */
function undimmed(before: Image, after: Image, keep: Rect, width: number, height: number) {
  let bright = 0;
  let still = 0;
  for (let y = 1; y < height; y += 3) {
    for (let x = 1; x < width; x += 3) {
      if (inside(keep, x, y)) continue;
      const [was, now] = [at(before, x, y), at(after, x, y)];
      if (!was || !now || Math.max(...was) < 170) continue;
      bright++;
      if (Math.max(...now) > Math.max(...was) - 40) still++;
    }
  }
  if (bright < 200) throw new Error(`too little bright before to tell (${bright})`);
  return still / bright;
}

interface Map {
  shows: boolean;
  folded?: boolean;
  outer?: [number, number, number, number];
}

const mapNow = async () => (await shellCommand<{ wm: { map: Map } }>("compositor_stats")).wm.map;

/** A plugin window's middle outside `away`, where a press would raise it. */
async function windowOutside(away: Rect): Promise<{ x: number; y: number }> {
  const desk = await deskNow();
  for (const w of onScreen(desk).filter((w) => w.panes.some((p) => p.plugin))) {
    for (const [fx, fy] of [
      [0.5, 0.6],
      [0.2, 0.8],
      [0.8, 0.8],
    ] as const) {
      const p = { x: Math.round(w.x + w.w * fx), y: Math.round(w.y + w.h * fy) };
      const clear = p.x > 0 && p.y > 0 && p.x < desk.screen.w && p.y < desk.screen.h;
      if (clear && !inside(grow(away, 8), p.x, p.y)) return p;
    }
  }
  throw new Error("no plugin window outside the dialog");
}

const order = async () =>
  onScreen(await deskNow()).map((w) => `${w.id} z${w.z ?? -1}${w.focused ? " focused" : ""}`);

const pointer = (p: { x: number; y: number }) => ({ type: "pointerMoved", x: p.x, y: p.y });
const button = (pressed: boolean) => ({ type: "pointerButton", button: "left", pressed });

describe("system modals: what the desk opens lies whole over every window, its scrim over them all", () => {
  let width = 0;
  let height = 0;

  before(async () => {
    await shellReady();
    await feed([{ type: "windowFocused", focused: true }]);
    ({ w: width, h: height } = (await deskNow()).screen);
  });

  /** Open a modal by `command`, then check its dialog `dialog` whole and its scrim over the rest. */
  async function opened(command: string, dialog: string): Promise<Rect> {
    const before = await settled(width);
    await run(command);
    const box = await boxOf(dialog);
    const after = await settled(width);
    // Its scrim dims everything outside it (its shadow left out).
    expect(undimmed(before, after, grow(box, 40), width, height)).toBeLessThan(0.02);
    // The dialog is what the page draws there: no window, title or band of one through it.
    const page = await pageShot(width);
    expect(differing(after, page, grow(box, -4))).toBeLessThan(0.03);
    return box;
  }

  it("dims every window, the dock and the map under a desktop's Rename dialog, and a press outside it is the dialog's", async () => {
    const box = await opened("desk.shell.desktop-rename", ".desktops-dialog .dialog");
    const away = await windowOutside(box);
    const was = await order();
    await feed([pointer(away)]);
    expect((await inputState()).pointer.hearing).toEqual(["desk"]);
    // A press on the scrim closes the dialog and raises no window.
    await feed([pointer(away), button(true), button(false)]);
    await gone(".desktops-dialog");
    await browser.pause(450);
    expect(await order()).toEqual(was);
  });

  it("draws the desktops' overview whole over every window, Eris and the dock", async () => {
    await opened("desk.shell.desktops-overview", ".desktops-overview-panel");
    await run("desk.shell.desktops-overview");
    await gone(".desktops-overview");
  });

  it("lays the settings over the canvas map, its backdrop over the windows", async () => {
    let map: Map | undefined;
    await browser.waitUntil(
      async () => {
        map = await mapNow();
        return map.shows && !map.folded;
      },
      { timeoutMsg: "the canvas map never showed open" },
    );
    const [mx = 0, my = 0, mw = 0, mh = 0] = map?.outer ?? [];
    const box = await opened("desk.settings.open", "dialog.desk-settings[open]");
    const x = Math.max(box.x, mx);
    const y = Math.max(box.y, my);
    const over = {
      x,
      y,
      w: Math.min(box.x + box.w, mx + mw) - x,
      h: Math.min(box.y + box.h, my + mh) - y,
    };
    if (over.w <= 8 || over.h <= 8)
      throw new Error(`the settings do not meet the map: ${JSON.stringify(map)}`);
    // Where the map lies under them, the settings show, and hear the pointer.
    const page = await pageShot(width);
    expect(differing(await settled(width), page, grow(over, -2))).toBeLessThan(0.03);
    await feed([pointer({ x: Math.round(x + over.w / 2), y: Math.round(y + over.h / 2) })]);
    expect((await inputState()).pointer.hearing).toEqual(["desk"]);
    expect((await inputState()).focused).toBe("desk");
    await feed(keyPress("Escape", "Escape"));
    await gone("dialog.desk-settings[open]");
  });
});
