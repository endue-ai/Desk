import { expect, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });

test.beforeEach(async ({ page }) => {
  await openShell(page, "?lang=en");
  await page.keyboard.press("Meta+n");
});

test("a drag survives status redraws and Escape restores the saved position", async ({ page }) => {
  const surface = page.locator('[data-surface="window-1"]');
  const before = await surface.boundingBox();
  if (!before) throw new Error("no window");
  await page.mouse.move(before.x + 80, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + 160, before.y + 70, { steps: 3 });
  const preview = await surface.boundingBox();
  expect(preview?.x).toBe(before.x + 80);
  await page.evaluate(() => window.__shell.desk.store.set({ tasks: [] }));
  expect(await surface.boundingBox()).toEqual(preview);
  await expect(surface).toHaveCSS("cursor", "grabbing");
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).not.toHaveClass(/is-grabbing/);
  await expect(surface).not.toHaveClass(/is-dragging/);
  expect(await surface.boundingBox()).toEqual(before);
  await page.mouse.up();
  expect(await surface.boundingBox()).toEqual(before);
});

test("resize keeps its diagonal cursor and losing app focus cancels it", async ({ page }) => {
  const surface = page.locator('[data-surface="window-1"]');
  const before = await surface.boundingBox();
  const grip = await surface.locator('[data-resize="se"]').boundingBox();
  if (!grip) throw new Error("no resize grip");
  await page.mouse.move(grip.x + 8, grip.y + 8);
  await page.mouse.down();
  await page.mouse.move(grip.x + 48, grip.y + 48, { steps: 3 });
  await expect(surface).toHaveCSS("cursor", "nwse-resize");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator("html")).not.toHaveClass(/is-grabbing/);
  expect(await surface.boundingBox()).toEqual(before);
  await page.mouse.up();
});

test("closing a window during a drag releases the pointer and the next window works", async ({
  page,
}) => {
  const surface = page.locator('[data-surface="window-1"]');
  const before = await surface.boundingBox();
  if (!before) throw new Error("no window");
  await page.mouse.move(before.x + 80, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + 120, before.y + 50, { steps: 3 });
  await page.keyboard.press("Meta+w");
  await expect(surface).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveClass(/is-grabbing/);
  await page.mouse.up();
  await page.keyboard.press("Meta+n");
  await surface.locator('[data-view="notes"]').click();
  await expect(surface.locator("textarea")).toBeVisible();
});

test("split dividers keep keyboard focus across repeated arrow adjustments", async ({ page }) => {
  await page.keyboard.press("Meta+d");
  const divider = page.locator('[data-surface="window-1"] .divider');
  await divider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(divider).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(divider).toHaveAttribute("aria-valuenow", "40");
  await expect(divider).toBeFocused();
  const bounds = await divider.boundingBox();
  if (!bounds) throw new Error("no divider");
  await page.mouse.move(bounds.x, bounds.y + 60);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 40, bounds.y + 60, { steps: 3 });
  await expect(divider).toHaveCSS("cursor", "col-resize");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(divider).toHaveAttribute("aria-valuenow", "40");
});

test("profile dialogs contain focus, block background shortcuts and return to the trigger", async ({
  page,
}) => {
  await page.locator(".mode-add").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("input")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.locator("input")).toBeFocused();
  await page.keyboard.press("Meta+n");
  await expect(page.locator('[data-surface="window-2"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".mode-add")).toBeFocused();
  await page.keyboard.press("Meta+n");
  await expect(page.locator('[data-surface="window-2"]')).toBeVisible();
});
