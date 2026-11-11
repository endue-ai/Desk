// Popup widgets through the compositor (#156): a select's list and the date, time and colour pickers
// are popups off-screen Chromium paints apart from their page. The compositor draws each over its
// surface where the page puts it (`compositor_window/draw_popup.rs`), the pointer on it reaches it,
// and the host makes room for its first frame among the desk's other browsers
// (`web_host/popup_room.rs`): the desk shows more browsers than Chromium keeps frames for, which
// left every popup unpainted. Each case opens one by pointer on the popup fixture
// (e2e/fixtures/plugin-e2e-popup), finds it in the composed frame and picks by pointer. Whatever the
// first layout gives the fixture's window, it takes the app's left half here, so the windows on the
// right half stay in sight with their browsers shown, and its fields move clear of the desk's bars;
// every point is taken from a field's box or the popup's, and pressed once the fixture hears the
// pointer there. The events are winit's, fed to the compositor window's own input entry
// (support/compositor.ts): the screen may be locked.
import { browser, expect } from "@wdio/globals";
import { feed, inputState, inSurface, keyPress, shellCommand } from "../support/compositor";
import { shellReady } from "../support/desk";
import { drag, titleAt } from "../support/gestures";
import { composedFrame, decodePng, difference, type Image, pixel } from "../support/pixels";
import { byId, deskNow, type Rect, rectOf, run, windowNow, windowUntil } from "../support/windows";

const POPUP = "main.e2e-popup";
/** The popup fixture's window. */
const WINDOW = "e2e.popup";
/** The fixture window as the first layout gave it, before the first cases snap it. */
let first: Rect | undefined;
/** A surface with its browser shown, as `compositor_stats` names its state. */
const SHOWN = "Live { hidden: false }";

interface Stats {
  popups: Record<string, { place: number[]; texture: number[] }>;
  surfaces: Record<string, { rect: number[] | null; screen?: number[] | null; state: string }>;
}

type Box = [number, number, number, number];
const stats = () => shellCommand<Stats>("compositor_stats");
const values = () => inSurface<Record<string, string>>(POPUP, "window.e2ePopup.values");
const heard = () =>
  inSurface<Array<{ type: string; field: string }>>(POPUP, "window.e2ePopup.events");

/** The fixture's surface in the window: its top left. */
async function origin(): Promise<[number, number]> {
  const [x = 0, y = 0] = (await stats()).surfaces[POPUP]?.rect ?? [];
  return [x, y];
}

/** Where field `id` is in the fixture's page. */
const field = (id: string) =>
  inSurface<Box>(
    POPUP,
    `(() => { const r = document.querySelector('[data-testid=${id}]').getBoundingClientRect();
      return [r.x, r.y, r.width, r.height]; })()`,
  );

/** The open popup's box in the window, once it painted. */
async function popupBox(): Promise<Box> {
  await browser.waitUntil(async () => (await stats()).popups[POPUP] !== undefined, {
    timeout: 10_000,
    timeoutMsg: "no popup painted",
  });
  const [px = 0, py = 0, pw = 0, ph = 0] = (await stats()).popups[POPUP]?.place ?? [];
  const [ox, oy] = await origin();
  return [ox + px, oy + py, pw, ph];
}

const closed = () =>
  browser.waitUntil(async () => (await stats()).popups[POPUP] === undefined, {
    timeout: 10_000,
    timeoutMsg: "the popup stayed open",
  });

/** The composed frame in CSS pixels. */
async function frame(): Promise<Image> {
  const png = await composedFrame();
  const { scale } = (await inputState()) as unknown as { scale: number };
  const img = decodePng(png);
  return { ...img, scale };
}

/** The share of `box` (inside the window's 2 px) unlike the fixture page's background #1e1d21. */
function unlikePage(img: Image, [x, y, w, h]: Box): number {
  let seen = 0;
  let unlike = 0;
  for (let cy = y + 2; cy < y + h - 2; cy += 3) {
    for (let cx = x + 2; cx < x + w - 2; cx += 3) {
      const rgb = pixel(img, Math.round(cx * img.scale), Math.round(cy * img.scale));
      if (!rgb) continue;
      seen++;
      const [r = 0, g = 0, b = 0] = rgb;
      if (Math.abs(r - 0x1e) + Math.abs(g - 0x1d) + Math.abs(b - 0x21) > 40) unlike++;
    }
  }
  return seen ? unlike / seen : 0;
}

/** A click at window point `at` once the fixture's surface (no bar of the desk over it) hears the
 * pointer there. */
async function click(at: [number, number]): Promise<void> {
  await feed([{ type: "pointerMoved", x: at[0], y: at[1] }]);
  const hearing = (await inputState()).pointer.hearing;
  if (!hearing.includes(POPUP)) throw new Error(`${at} is under ${hearing.join(", ")}`);
  await feed([
    { type: "pointerButton", button: "left", pressed: true },
    { type: "pointerButton", button: "left", pressed: false },
  ]);
}

/** A click at the fixture's own point `local`. */
async function clickAt(local: [number, number]): Promise<void> {
  const [ox, oy] = await origin();
  await click([ox + local[0], oy + local[1]]);
}

/** Open a popup with a click at the fixture's point `local`; its box, drawn where it lies. */
async function open(local: [number, number]): Promise<Box> {
  const before = await frame();
  await clickAt(local);
  const box = await popupBox();
  const after = await frame();
  // The popup's pixels are in the composed frame, over the page's dark ones.
  expect(unlikePage(after, box) - unlikePage(before, box)).toBeGreaterThan(0.3);
  return box;
}

describe("popups: select lists and the date, time and colour pickers are drawn and usable", () => {
  before(async () => {
    await shellReady();
    await browser.waitUntil(
      async () =>
        (await inSurface<string>(
          POPUP,
          "document.querySelector('[data-testid=ready]').textContent",
        )) === "ready",
      { timeout: 20_000, timeoutMsg: "the popup plugin never mounted" },
    );
    await feed([{ type: "windowFocused", focused: true }]);
    // The window in use takes the app's left half, so no first layout decides what of it shows,
    // and the windows on the right half stay in sight (a fill would hide every one of them).
    await browser.waitUntil(
      async () => {
        await run("desk.display.show", { plugin: WINDOW });
        return byId(await deskNow(), WINDOW)?.focused === true;
      },
      { timeout: 15_000, interval: 300, timeoutMsg: `${WINDOW} is not shown and in use` },
    );
    first = rectOf(await windowNow(WINDOW));
    await run("desk.display.snap-left");
    await windowUntil(
      WINDOW,
      (w) => w.state === "snapped" && w.fill === "left",
      "taking the left half",
    );
    await inSurface<boolean>(POPUP, "(document.body.dataset.layout = 'middle', true)");
    await browser.pause(500);
    // More browsers shown than Chromium keeps frames for (five): what made every popup paint
    // nothing.
    const shown = Object.values((await stats()).surfaces).filter((s) => s.state === SHOWN).length;
    expect(shown).toBeGreaterThan(5);
  });

  it("a select's list opens under it and a click picks the third option", async () => {
    const [x, y, w, h] = await field("select");
    const [bx, by, bw, bh] = await open([x + w / 2, y + h / 2]);
    // Five options one under another: the third's middle is the list's.
    await click([bx + bw / 2, by + bh / 2]);
    await closed();
    expect((await values()).select).toBe("three");
  });

  it("Escape closes the list without a pick, and the page never hears the key", async () => {
    const [x, y, w, h] = await field("select");
    await open([x + w / 2, y + h / 2]);
    const keys = (await heard()).filter((e) => e.type === "keydown").length;
    await feed(keyPress("Escape", "Escape"));
    await closed();
    expect((await values()).select).toBe("three");
    expect((await heard()).filter((e) => e.type === "keydown").length).toBe(keys);
  });

  it("a press elsewhere in the page closes the list", async () => {
    const [x, y, w, h] = await field("select");
    await open([x + w / 2, y + h / 2]);
    // Left of the fields and under them: no popup opens there.
    await clickAt([x - 100, y + 200]);
    await closed();
    expect((await values()).select).toBe("three");
  });

  it("a date field's picker opens by its icon and a click picks a day", async () => {
    const [x, y, w, h] = await field("date");
    const [bx, by, bw, bh] = await open([x + w - 12, y + h / 2]);
    // November 2026 under the month: the middle of the grid is a day of its third week.
    await click([bx + bw / 2, by + bh / 2]);
    await closed();
    expect((await values()).date).toMatch(/^2026-11-(1[3-9]|2[0-2])$/);
  });

  it("a time field's picker opens by its icon and a click picks an hour", async () => {
    const [x, y, w, h] = await field("time");
    const [bx, by] = await open([x + w - 12, y + h / 2]);
    // Hours in the first column from 09 down, one a row: two rows down is 11.
    await click([bx + 28, by + 90]);
    await browser.waitUntil(async () => (await values()).time === "11:30", {
      timeoutMsg: `the hour was not picked: ${(await values()).time}`,
    });
    await feed(keyPress("Enter", "Enter"));
    await closed();
  });

  it("a colour field's picker opens and a click in its field picks a colour", async () => {
    const [x, y, w, h] = await field("color");
    const [bx, by, bw] = await open([x + w / 2, y + h / 2]);
    await click([bx + bw * 0.1, by + 20]);
    await browser.waitUntil(async () => (await values()).color !== "#3366cc", {
      timeoutMsg: "no colour was picked",
    });
    const [sx, sy] = await field("select");
    await clickAt([sx - 100, sy + 200]);
    await closed();
    expect((await heard()).some((e) => e.type === "change" && e.field === "color")).toBe(true);
  });
});

// A window at its first size (C1: 328 × 211 at 1280 × 800) has a pane 169 px tall, shorter than the
// date picker (281 px), the time picker (260) and the colour picker (252). Each page's screen is the
// app window, the pane at its place in it (`web_host/popup_screen.rs`), so Chromium puts a picker
// under its field past the pane, and the compositor draws it whole above the windows, the pointer
// reaching its parts outside the pane (`compositor_window/draw_popup.rs`; B6b, #156).
describe("popups at a window's first size: drawn whole past the pane, and usable there", () => {
  /** Where the window takes back its own size: high in the app's free middle, so a picker under a
   * field has room below, clear of Eris above and of the dock and the canvas map below. */
  const DROP = { x: 420, y: 230 };
  /** In the date picker of November 2026 (Sunday the 1st), from its top left: Monday the 30th,
   * which starts the fifth row; from its bottom right: Today, the bottom row's right button. */
  const LAST_WEEK: [number, number] = [53, 200];
  const TODAY: [number, number] = [40, 22];

  before(async () => {
    // Dragged by its title out of the half the cases above snapped it to, the window takes back
    // its own size under the pointer (ADR 0128), its fields back at their first places.
    await drag(titleAt(rectOf(await windowNow(WINDOW)), 160), DROP);
    const back = await windowUntil(WINDOW, (w) => w.state === "normal", "its own size again");
    if (first) expect({ w: back.w, h: back.h }).toEqual({ w: first.w, h: first.h });
    await inSurface<boolean>(POPUP, "(delete document.body.dataset.layout, true)");
    // Its page is told where the window rests, its screen the app window, and that its popups
    // go between the desk's bars.
    const { screen } = await deskNow();
    await browser.waitUntil(
      async () => {
        const { rect, screen: told } = (await stats()).surfaces[POPUP] ?? {};
        const [x = 0, y = 0] = rect ?? [];
        return `${told}` === `${[Math.round(x), Math.round(y), screen.w, screen.h]}`;
      },
      { timeout: 10_000, timeoutMsg: "the page was never told where its window is" },
    );
    await browser.waitUntil(
      async () =>
        (await inSurface<number>(POPUP, "screen.availTop")) > 0 &&
        (await inSurface<number>(POPUP, "screen.width")) === screen.w,
      { timeout: 10_000, timeoutMsg: "the page never heard its screen" },
    );
  });

  it("the date picker opens whole under its field; a day of its last week and Today pick", async () => {
    const [, oy = 0, , pane = 0] = (await stats()).surfaces[POPUP]?.rect ?? [];
    expect(pane).toBeLessThan(200);
    const [x, y, w, h] = await field("date");
    const before = await frame();
    const [bx, by, bw, bh] = await open([x + w - 12, y + h / 2]);
    // Under its field, taller than the pane and past its bottom.
    expect(by).toBeGreaterThanOrEqual(oy + y + h - 1);
    expect(bh).toBeGreaterThan(pane);
    expect(by + bh).toBeGreaterThan(oy + pane + 50);
    // Its bottom row (Clear and Today) is drawn: what lay there before shows no more.
    const strip = { x: bx, y: by + bh - 28, w: bw, h: 28 };
    expect(difference(before, strip, await frame(), strip, { inset: 2 })).toBeGreaterThan(0.3);
    // A day of the month's last week, outside the pane: picked.
    await click([bx + LAST_WEEK[0], by + LAST_WEEK[1]]);
    await closed();
    expect((await values()).date).toBe("2026-11-30");
    // Open again: Today picks the page's today.
    const [tx, ty, tw, th] = await open([x + w - 12, y + h / 2]);
    await click([tx + tw - TODAY[0], ty + th - TODAY[1]]);
    await closed();
    const today = await inSurface<string>(
      POPUP,
      "(() => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return [d.getFullYear(), p(d.getMonth() + 1), p(d.getDate())].join('-'); })()",
    );
    expect((await values()).date).toBe(today);
  });
});
