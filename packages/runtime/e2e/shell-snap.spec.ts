// Snapping (ADR 0128): a window dragged by its title bar to one of the app's edges takes that half
// of the free area, to a corner that quarter, a preview showing where while the pointer is there.
// A snapped window floats, so Shift + drag (the canvas pan) leaves it where it was snapped, and
// dragging it out brings back its own size and mode.
import { expect, type Page, test } from "@playwright/test";
import { barsOver, DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });
const surface = (page: Page, id = 1) => page.locator(`[data-surface="window-${id}"]`);
const preview = (page: Page) => page.locator(".surface-snap");

// The free area at 1440 × 900, under Eris in her default place: 104, 190, 1232 × 622.
const W = 610;
const H = 305;
const TARGETS = [
  { snap: "left", to: [3, 450], rect: { x: 104, y: 190, width: W, height: 622 } },
  { snap: "right", to: [1437, 450], rect: { x: 726, y: 190, width: W, height: 622 } },
  { snap: "top", to: [720, 2], rect: { x: 104, y: 190, width: 1232, height: H } },
  { snap: "bottom", to: [720, 897], rect: { x: 104, y: 507, width: 1232, height: H } },
  { snap: "top-left", to: [3, 3], rect: { x: 104, y: 190, width: W, height: H } },
  { snap: "top-right", to: [1437, 3], rect: { x: 726, y: 190, width: W, height: H } },
  { snap: "bottom-left", to: [3, 897], rect: { x: 104, y: 507, width: W, height: H } },
  { snap: "bottom-right", to: [1437, 897], rect: { x: 726, y: 507, width: W, height: H } },
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
    expect(await win.boundingBox()).toEqual(rect);
    await expect(win).toHaveAttribute("data-floating", "true");
    await expect(win).toHaveAttribute("data-fill", snap);
    expect(await barsOver(page, '[data-surface="window-2"]')).toEqual([]);
    // Shift + drag on its own title bar pans the canvas: the normal window moves, it does not.
    const before = await other.boundingBox();
    const title = await win.locator(".surface-name").boundingBox();
    if (!before || !title) throw new Error("no window");
    await pan(page, title.x + 5, title.y + 5, -90, 40);
    expect(await page.evaluate(() => window.__shell.desk.store.get().pan[1])).toEqual({
      x: -90,
      y: 40,
    });
    expect(await other.boundingBox()).toEqual({ ...before, x: before.x - 90, y: before.y + 40 });
    expect(await win.boundingBox()).toEqual(rect);
  });
}

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
  expect(await win.boundingBox()).toEqual(TARGETS[4].rect);
  // Grabbed by its title and dropped in the middle of the desk: its own size, its title bar still
  // under the pointer.
  await grab(page, 1, 700, 500);
  await page.mouse.up();
  const back = await win.boundingBox();
  expect(back).toMatchObject({ width: before.width, height: before.height });
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
