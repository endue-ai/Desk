import { expect, type Page, test } from "@playwright/test";
import { chipsOverTitle, DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });
const surface = (page: Page, id = 1) => page.locator(`[data-surface="window-${id}"]`);
/** Shift + drag on the empty background, from (x, y): the canvas pans. */
const pan = async (page: Page, dx: number, dy: number, x = 1200, y = 700) => {
  await page.keyboard.down("Shift");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
};

for (const direction of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
  test(`resizes from ${direction} with the opposite edges anchored`, async ({ page }) => {
    await openShell(page, "?lang=en");
    await page.keyboard.press("Meta+n");
    const win = surface(page);
    const before = await win.boundingBox();
    const grip = win.locator(`[data-resize="${direction}"]`);
    const cursor =
      direction === "n" || direction === "s"
        ? "ns-resize"
        : direction === "e" || direction === "w"
          ? "ew-resize"
          : direction === "ne" || direction === "sw"
            ? "nesw-resize"
            : "nwse-resize";
    await grip.hover();
    await expect(grip).toHaveCSS("cursor", cursor);
    const handle = await grip.boundingBox();
    if (!before || !handle) throw new Error("no window");
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.down();
    await page.mouse.move(x - 40, y - 30, { steps: 5 });
    await expect(win).toHaveCSS("cursor", cursor);
    await page.mouse.up();
    expect(await win.boundingBox()).toEqual({
      x: before.x - (direction.includes("w") ? 40 : 0),
      y: before.y - (direction.includes("n") ? 30 : 0),
      width: before.width + (direction.includes("w") ? 40 : direction.includes("e") ? -40 : 0),
      height: before.height + (direction.includes("n") ? 30 : direction.includes("s") ? -30 : 0),
    });
    expect(await page.evaluate(() => document.getSelection()?.toString())).toBe("");
  });
}

test("a normal window follows the pan, a floating one stays anchored, and switching modes preserves position", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  await page.keyboard.press("Meta+n");
  const canvas = surface(page);
  // A new window is in normal mode.
  await expect(canvas).toHaveAttribute("data-floating", "false");
  const before = await canvas.boundingBox();
  await page.keyboard.press("Meta+n");
  const floating = surface(page, 2);
  const unfloated = await floating.boundingBox();
  await floating.getByRole("button", { name: "Floating mode" }).click();
  await expect(floating).toHaveAttribute("data-floating", "true");
  const fixed = await floating.boundingBox();
  expect(fixed).toEqual(unfloated);
  // A plain drag on the background does not pan.
  await page.mouse.move(1200, 700);
  await page.mouse.down();
  await page.mouse.move(1080, 760, { steps: 8 });
  await page.mouse.up();
  expect(await canvas.boundingBox()).toEqual(before);
  await pan(page, -120, 60);
  if (!before) throw new Error("no canvas window");
  expect(await canvas.boundingBox()).toEqual({ ...before, x: before.x - 120, y: before.y + 60 });
  expect(await floating.boundingBox()).toEqual(fixed);
  await page.setViewportSize({ width: 1100, height: 800 });
  // Chromium sends resize with the next frame: the floating window moves then, the normal one not.
  await expect.poll(() => floating.boundingBox()).not.toEqual(fixed);
  expect(await canvas.boundingBox()).toEqual({ ...before, x: before.x - 120, y: before.y + 60 });
  await page.setViewportSize(DESK);
  await floating.getByRole("button", { name: "Close", exact: true }).click();
  const moved = await canvas.boundingBox();
  await canvas.getByRole("button", { name: "Floating mode" }).click();
  expect(await canvas.boundingBox()).toEqual(moved);
  await page.getByRole("button", { name: "Reset canvas position" }).click();
  expect(await canvas.boundingBox()).toEqual(moved);
  await expect(page.getByRole("button", { name: "Reset canvas position" })).toHaveCount(0);
});

test("canvas movement survives redraws, cancellation and per-desktop navigation", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  await page.keyboard.press("Meta+n");
  const win = surface(page);
  const before = await win.boundingBox();
  await page.keyboard.down("Shift");
  await page.mouse.move(1200, 700);
  await page.mouse.down();
  await page.mouse.move(1100, 650, { steps: 5 });
  await page.keyboard.up("Shift");
  const preview = await win.boundingBox();
  await page.evaluate(() => window.__shell.desk.store.set({ tasks: [] }));
  expect(await win.boundingBox()).toEqual(preview);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await win.boundingBox()).toEqual(before);
  await pan(page, -100, -50);
  await page.locator('[data-desktop="2"]').click();
  expect(await page.evaluate(() => window.__shell.desk.store.get().pan[2])).toBeUndefined();
  await page.locator('[data-desktop="1"]').click();
  expect(await win.boundingBox()).toEqual(preview);
});

test("canvas drag stores world coordinates and restores the panned session", async ({ page }) => {
  await openShell(page, "?lang=en&persist=1");
  await page.evaluate(() => localStorage.clear());
  await openShell(page, "?lang=en&persist=1");
  await page.keyboard.press("Meta+n");
  const win = surface(page);
  await pan(page, -100, -50);
  const title = await win.locator(".surface-name").boundingBox();
  if (!title) throw new Error("no title");
  await page.mouse.move(title.x + 5, title.y + 5);
  await page.mouse.down();
  await page.mouse.move(title.x + 85, title.y + 45, { steps: 5 });
  await page.mouse.up();
  const moved = await win.boundingBox();
  expect(
    await page.evaluate(() => {
      const p = window.__shell.desk.store.get().session[1]?.surfaces[0];
      return p && { x: p.x, y: p.y };
    }),
  ).toEqual({ x: 560, y: 280 });
  await page.waitForTimeout(400);
  await openShell(page, "?lang=en&persist=1");
  await expect(win).toHaveAttribute("data-floating", "false");
  expect(await win.boundingBox()).toEqual(moved);
  await page.evaluate(() => localStorage.clear());
});

test("wheel over a pane does not pan, background wheel does", async ({ page }) => {
  await openShell(page, "?lang=en");
  await page.keyboard.press("Meta+n");
  const win = surface(page);
  await win.locator('[data-view="notes"]').click();
  const before = await win.boundingBox();
  await win.locator("textarea.notes-input").hover();
  await page.mouse.wheel(0, 120);
  expect(await win.boundingBox()).toEqual(before);
  await page.mouse.move(1200, 700);
  await page.mouse.wheel(0, 120);
  await expect
    .poll(() => page.evaluate(() => window.__shell.desk.store.get().pan[1]?.y))
    .toBe(-120);
});

test("maximize and restore take the whole app in sight of a panned canvas, the title clear of the chips", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  await page.keyboard.press("Meta+n");
  const canvas = surface(page);
  await pan(page, -100, -50);
  const before = await canvas.boundingBox();
  await canvas.locator(".surface-name").dblclick();
  await expect.poll(() => canvas.boundingBox()).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
  expect(await chipsOverTitle(page, '[data-surface="window-1"]')).toEqual([]);
  await canvas.locator(".surface-name").dblclick();
  await expect.poll(() => canvas.boundingBox()).toEqual(before);
});

test("Shift + drag on a title bar pans the canvas instead of moving the window", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  await page.keyboard.press("Meta+n");
  const win = surface(page);
  const before = await win.boundingBox();
  const title = await win.locator(".surface-name").boundingBox();
  if (!before || !title) throw new Error("no window");
  await pan(page, 80, 40, title.x + 5, title.y + 5);
  expect(await win.boundingBox()).toEqual({ ...before, x: before.x + 80, y: before.y + 40 });
  expect(await page.evaluate(() => window.__shell.desk.store.get().pan[1])).toEqual({
    x: 80,
    y: 40,
  });
  // The window itself did not move on the canvas.
  expect(
    await page.evaluate(() => window.__shell.desk.store.get().session[1]?.surfaces[0]?.x),
  ).toBe(480);
});

// #2: the canvas pan is the only way the view moves. Focusing a control under an edge, revealing
// it, or a script setting scrollTop leaves the shell and every bar where they are.
test("the shell never scrolls: revealing a control under the edge moves no bar", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  await page.keyboard.press("Meta+n");
  const win = surface(page);
  await expect(win).toBeVisible();
  const rail = page.locator(".rail");
  const before = await rail.boundingBox();
  await pan(page, 0, 500, 1200, 250);
  const under = win.locator(".launcher button").last();
  expect((await under.boundingBox())?.y).toBeGreaterThan(DESK.height);
  await under.evaluate((el) => (el as HTMLElement).focus());
  await under.evaluate((el) => el.scrollIntoView());
  await page.evaluate(() => {
    const shell = document.querySelector(".shell");
    if (shell) shell.scrollTop = 300;
  });
  const scrolled = await page.evaluate(() => {
    const shell = document.querySelector(".shell");
    return [shell?.scrollTop, shell?.scrollLeft, document.scrollingElement?.scrollTop];
  });
  expect(scrolled).toEqual([0, 0, 0]);
  expect(await rail.boundingBox()).toEqual(before);
});

test("the canvas map shows a window out of sight, and a press, a drag or a key moves the view", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  const map = page.getByRole("group", { name: "Canvas map" });
  const panNow = () =>
    page.evaluate(() => window.__shell.desk.store.get().pan[1] ?? { x: 0, y: 0 });
  // An empty canvas at the start has nothing to find.
  await expect(map).toHaveCount(0);
  await page.keyboard.press("Meta+n");
  await expect(map).toBeVisible();
  const win = surface(page);
  // The background wheel takes the window out of sight to the left; the map still draws it.
  await page.mouse.move(1200, 600);
  await page.mouse.wheel(1500, 0);
  await expect.poll(panNow).toEqual({ x: -1500, y: 0 });
  await expect(page.locator(".minimap-window")).toHaveCount(1);
  // A press on it brings the view to it: the window comes back with its middle near the centre.
  await page.locator(".minimap-window").click();
  const box = await win.boundingBox();
  if (!box) throw new Error("no window");
  expect(Math.abs(box.x + box.width / 2 - DESK.width / 2)).toBeLessThan(30);
  expect(Math.abs(box.y + box.height / 2 - DESK.height / 2)).toBeLessThan(30);
  // Dragging the part in sight moves the view the same way, many world pixels to one.
  const before = await panNow();
  const frame = await page.locator(".minimap-view").boundingBox();
  if (!frame) throw new Error("no view frame");
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width / 2 + 20, frame.y + frame.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await panNow()).x).toBeLessThan(before.x - 100);
  // Focused, the arrow keys step a quarter of the view and Home goes back to the start.
  await map.focus();
  await page.keyboard.press("Home");
  await expect.poll(panNow).toEqual({ x: 0, y: 0 });
  await page.keyboard.press("ArrowRight");
  await expect.poll(panNow).toEqual({ x: -DESK.width / 4, y: 0 });
  // It folds to one button and opens again.
  await page.getByRole("button", { name: "Fold the canvas map" }).click();
  await expect(map).toBeHidden();
  await page.getByRole("button", { name: "Show the canvas map" }).click();
  await expect(map).toBeVisible();
});
