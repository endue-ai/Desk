// Snapping (ADR 0128): a window dragged by its title bar to one of the app's edges takes that half
// of the whole app (ADR 0132), to a corner that quarter, a preview showing where while the pointer
// is there; the bars float above it, its title clear of the top chips. A snapped window floats, so
// Shift + drag (the canvas pan) leaves it where it was snapped, and dragging it out brings back its
// own size and mode. Windows glide into place, so their boxes are polled.
import { expect, type Page, test } from "@playwright/test";
import { chipsOverTitle, DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });
const surface = (page: Page, id = 1) => page.locator(`[data-surface="window-${id}"]`);
const preview = (page: Page) => page.locator(".surface-snap");

// The whole app at 1440 × 900: halves and quarters 12 px apart.
const W = 714;
const H = 444;
const TARGETS = [
  { snap: "left", to: [3, 450], rect: { x: 0, y: 0, width: W, height: 900 } },
  { snap: "right", to: [1437, 450], rect: { x: 726, y: 0, width: W, height: 900 } },
  { snap: "top", to: [720, 2], rect: { x: 0, y: 0, width: 1440, height: H } },
  { snap: "bottom", to: [720, 897], rect: { x: 0, y: 456, width: 1440, height: H } },
  { snap: "top-left", to: [3, 3], rect: { x: 0, y: 0, width: W, height: H } },
  { snap: "top-right", to: [1437, 3], rect: { x: 726, y: 0, width: W, height: H } },
  { snap: "bottom-left", to: [3, 897], rect: { x: 0, y: 456, width: W, height: H } },
  { snap: "bottom-right", to: [1437, 897], rect: { x: 726, y: 456, width: W, height: H } },
] as const;

/** Press on a window's title, move to (x, y) in steps, and leave the button down. */
async function grab(page: Page, id: number, x: number, y: number) {
  const title = await surface(page, id).locator(".surface-name").boundingBox();
  if (!title) throw new Error(`no title on window-${id}`);
  await page.mouse.move(title.x + 5, title.y + 5);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
}

/** Shift + drag from (x, y): the canvas pans, from a title bar or from the empty background. */
async function pan(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.keyboard.down("Shift");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
}

for (const { snap, to, rect } of TARGETS) {
  test(`dragged to the ${snap}, a window snaps there, floating, and a pan leaves it there`, async ({
    page,
  }) => {
    await openShell(page, "?lang=en");
    await page.keyboard.press("Meta+n");
    await page.keyboard.press("Meta+n");
    const win = surface(page, 2);
    const other = surface(page, 1);
    await expect(win).toHaveAttribute("data-floating", "false");
    await grab(page, 2, to[0], to[1]);
    // Before the drop, the preview shows the rect the window will take.
    await expect(preview(page)).toHaveAttribute("data-snap", snap);
    await expect(preview(page)).toHaveCSS("left", `${rect.x}px`);
    await expect(preview(page)).toHaveCSS("top", `${rect.y}px`);
    await expect(preview(page)).toHaveCSS("width", `${rect.width}px`);
    await expect(preview(page)).toHaveCSS("height", `${rect.height}px`);
    await page.mouse.up();
    await expect(preview(page)).toHaveCount(0);
    await expect.poll(() => win.boundingBox()).toEqual(rect);
    await expect(win).toHaveAttribute("data-floating", "true");
    await expect(win).toHaveAttribute("data-fill", snap);
    expect(await chipsOverTitle(page, '[data-surface="window-2"]')).toEqual([]);
    // Shift + drag on its own title bar pans the canvas: the normal window moves, it does not. Just
    // past its title: the bar's start may lie under the side bar, which floats above it.
    const before = await other.boundingBox();
    const title = await win.locator(".surface-name").boundingBox();
    if (!before || !title) throw new Error("no window");
    await pan(page, title.x + title.width + 16, title.y + 5, -90, 40);
    expect(await page.evaluate(() => window.__shell.desk.store.get().pan[1])).toEqual({
      x: -90,
      y: 40,
    });
    expect(await other.boundingBox()).toEqual({ ...before, x: before.x - 90, y: before.y + 40 });
    expect(await win.boundingBox()).toEqual(rect);
  });
}

test("the preview grows out of the window, and the window glides into it", async ({ page }) => {
  // The container's WebKit may ask for reduced motion, and the fixture stops every transition so
  // the other specs read final boxes: lift both for this page.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openShell(page, "?lang=en");
  await page.evaluate(() => {
    for (const style of document.querySelectorAll("head style"))
      style.textContent = (style.textContent ?? "").replace(/^.*transition: none.*$/mu, "");
  });
  await page.keyboard.press("Meta+n");
  const win = surface(page);
  await grab(page, 1, 3, 450);
  // Shown where the window is, then moving to the half: a transition, not a jump.
  await expect(preview(page)).toHaveAttribute("data-snap", "left");
  const motion = (sel: string) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      return el ? getComputedStyle(el).transitionProperty : "";
    }, sel);
  expect(await motion(".surface-snap")).toContain("width");
  await expect(preview(page)).toHaveCSS("width", `${W}px`);
  await page.mouse.up();
  await expect(win).toHaveClass(/is-settling/);
  expect(await motion('[data-surface="window-1"]')).toContain("left");
  await expect(win).not.toHaveClass(/is-settling/);
  expect(await win.boundingBox()).toEqual(TARGETS[0].rect);
});

test("the preview follows the pointer from zone to zone, and Escape leaves the window where it was", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  await page.keyboard.press("Meta+n");
  const win = surface(page);
  const before = await win.boundingBox();
  await grab(page, 1, 3, 450);
  await expect(preview(page)).toHaveAttribute("data-snap", "left");
  await page.mouse.move(3, 60, { steps: 4 });
  await expect(preview(page)).toHaveAttribute("data-snap", "top-left");
  await page.mouse.move(400, 400, { steps: 4 });
  await expect(preview(page)).toHaveCount(0);
  await page.mouse.move(1437, 897, { steps: 8 });
  await expect(preview(page)).toHaveAttribute("data-snap", "bottom-right");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(preview(page)).toHaveCount(0);
  expect(await win.boundingBox()).toEqual(before);
  await expect(win).toHaveAttribute("data-floating", "false");
});

test("dropped short of an edge, a window stays where it was dropped", async ({ page }) => {
  await openShell(page, "?lang=en");
  await page.keyboard.press("Meta+n");
  const win = surface(page);
  await grab(page, 1, 60, 450);
  await expect(preview(page)).toHaveCount(0);
  await page.mouse.up();
  await expect(win).toHaveAttribute("data-floating", "false");
  await expect(win).not.toHaveAttribute("data-fill", /.*/);
});

test("dragged out of its snap, a window takes back its size and its mode, under the pointer", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  await page.keyboard.press("Meta+n");
  const win = surface(page);
  const before = await win.boundingBox();
  if (!before) throw new Error("no window");
  await grab(page, 1, 3, 3);
  await page.mouse.up();
  await expect.poll(() => win.boundingBox()).toEqual(TARGETS[4].rect);
  // Grabbed by its title and dropped in the middle of the desk: its own size, its title bar still
  // under the pointer.
  await grab(page, 1, 700, 500);
  await page.mouse.up();
  await expect
    .poll(async () => {
      const box = await win.boundingBox();
      return box && { width: box.width, height: box.height };
    })
    .toEqual({ width: before.width, height: before.height });
  const back = await win.boundingBox();
  if (!back) throw new Error("no window");
  expect(back.x).toBeLessThan(700);
  expect(back.x + back.width).toBeGreaterThan(700);
  expect(back.y).toBeLessThan(500);
  expect(back.y + 40).toBeGreaterThan(500);
  await expect(win).toHaveAttribute("data-floating", "false");
  await expect(win).not.toHaveAttribute("data-fill", /.*/);
  // Normal again: it moves with the canvas.
  await pan(page, 1200, 250, -100, 0);
  expect(await win.boundingBox()).toEqual({ ...back, x: back.x - 100 });
});
