import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });
const surface = (page: Page, id = 1) => page.locator(`[data-surface="window-${id}"]`);
const pan = async (page: Page, dx: number, dy: number) => {
  await page.mouse.move(1200, 700);
  await page.mouse.down();
  await page.mouse.move(1200 + dx, 700 + dy, { steps: 8 });
  await page.mouse.up();
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

test("canvas follows pan, floating stays anchored, and switching modes preserves position", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  await page.keyboard.press("Meta+n");
  const canvas = surface(page);
  const before = await canvas.boundingBox();
  await canvas.getByRole("button", { name: "Floating mode" }).click();
  await expect(canvas).toHaveAttribute("data-floating", "false");
  expect(await canvas.boundingBox()).toEqual(before);
  await page.keyboard.press("Meta+n");
  const floating = surface(page, 2);
  const fixed = await floating.boundingBox();
  await pan(page, -120, 60);
  if (!before) throw new Error("no canvas window");
  expect(await canvas.boundingBox()).toEqual({ ...before, x: before.x - 120, y: before.y + 60 });
  expect(await floating.boundingBox()).toEqual(fixed);
  await page.setViewportSize({ width: 1100, height: 800 });
  expect(await canvas.boundingBox()).toEqual({ ...before, x: before.x - 120, y: before.y + 60 });
  expect(await floating.boundingBox()).not.toEqual(fixed);
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
  await win.getByRole("button", { name: "Floating mode" }).click();
  const before = await win.boundingBox();
  await page.mouse.move(1200, 700);
  await page.mouse.down();
  await page.mouse.move(1100, 650, { steps: 5 });
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
  await win.getByRole("button", { name: "Floating mode" }).click();
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
  await win.getByRole("button", { name: "Floating mode" }).click();
  await win.locator('[data-view="notes"]').click();
  const before = await win.boundingBox();
  await win.locator("textarea").hover();
  await page.mouse.wheel(0, 120);
  expect(await win.boundingBox()).toEqual(before);
  await page.mouse.move(1200, 700);
  await page.mouse.wheel(0, 120);
  await expect
    .poll(() => page.evaluate(() => window.__shell.desk.store.get().pan[1]?.y))
    .toBe(-120);
});

test("maximize and restore use the visible area of a panned canvas", async ({ page }) => {
  await openShell(page, "?lang=en");
  await page.keyboard.press("Meta+n");
  const canvas = surface(page);
  await canvas.getByRole("button", { name: "Floating mode" }).click();
  await pan(page, -100, -50);
  const before = await canvas.boundingBox();
  await canvas.locator(".surface-name").dblclick();
  expect(await canvas.boundingBox()).toEqual({ x: 104, y: 190, width: 1232, height: 622 });
  await canvas.locator(".surface-name").dblclick();
  expect(await canvas.boundingBox()).toEqual(before);
});
