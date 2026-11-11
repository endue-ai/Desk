// Popup widgets through the compositor (#156): a select's list and the date, time and colour pickers
// are popups off-screen Chromium paints apart from their page. The compositor draws each over its
// surface where the page puts it (`compositor_window/draw_popup.rs`), the pointer on it reaches it,
// and the host makes room for its first frame among the desk's other browsers
// (`web_host/popup_room.rs`): the desk shows more browsers than Chromium keeps frames for, which
// left every popup unpainted. Each case opens one by pointer on the popup fixture
// (e2e/fixtures/plugin-e2e-popup), finds it in the composed frame and picks by pointer. The events
// are winit's, fed to the compositor window's own input entry (support/compositor.ts): the screen
// may be locked.
import { browser, expect } from "@wdio/globals";
import { click, feed, inputState, inSurface, keyPress, shellCommand } from "../support/compositor";
import { shellReady } from "../support/desk";
import { drag, titleAt } from "../support/gestures";
import { composedFrame, decodePng, type Image, pixel } from "../support/pixels";

const POPUP = "main.e2e-popup";

interface Stats {
  browsers: number;
  popups: Record<string, { place: number[]; texture: number[] }>;
  surfaces: Record<string, { rect: number[] | null }>;
  windows: Array<{ id: string; rect: number[] }>;
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

/** Open a popup with a click at the fixture's point `local`; its box, drawn where it lies. */
async function open(local: [number, number]): Promise<Box> {
  const [ox, oy] = await origin();
  const before = await frame();
  await click([ox + local[0], oy + local[1]]);
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
    // The fixture's window in full view, clear of the bars: dragged there by its title bar.
    const win = (await stats()).windows.find((w) => w.id === "e2e.popup");
    const [x = 0, y = 0, w = 0, h = 0] = win?.rect ?? [];
    const from = titleAt({ x, y, w, h });
    await drag(from, { x: from.x + 200 - x, y: from.y + 220 - y }, { steps: 12 });
    await browser.waitUntil(async () => (await origin())[0] < 300, {
      timeoutMsg: "the fixture's window did not move",
    });
    await browser.pause(500);
    // More browsers than Chromium keeps frames for: what made every popup paint nothing.
    expect((await stats()).browsers).toBeGreaterThan(5);
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
    const [ox, oy] = await origin();
    await click([ox + 60, oy + 200]);
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
    const [ox, oy] = await origin();
    await click([ox + 60, oy + 200]);
    await closed();
    expect((await heard()).some((e) => e.type === "change" && e.field === "color")).toBe(true);
  });
});
