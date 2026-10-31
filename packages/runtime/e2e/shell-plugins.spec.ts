// Plugin surfaces as shell windows: the shell fixture with ?plugins=1 installs the UI test plugins,
// whose centre surfaces open inside the shell's windows (ADR 0040). One window manager: drag, resize,
// snap, maximize, the drawer and the plugin's on/off all go through it.
import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell, step } from "./shell-helpers";

test.use({ viewport: DESK });

const COUNTER = "test.counter";
const window_ = (page: Page) => page.locator(`section.surface[data-surface="${COUNTER}"]`);
const inner = (page: Page) => page.locator(`.desk-surface[data-surface="${COUNTER}"]`);
const frame = (page: Page) => page.frameLocator(`.desk-surface[data-surface="${COUNTER}"] iframe`);
const box = async (page: Page) => {
  const b = await window_(page).boundingBox();
  if (!b) throw new Error("no window");
  return b;
};

async function dragTitle(page: Page, dx: number, dy: number) {
  const b = await box(page);
  await page.mouse.move(b.x + 120, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 120 + dx / 2, b.y + 20 + dy / 2, { steps: 4 });
  await page.mouse.move(b.x + 120 + dx, b.y + 20 + dy, { steps: 4 });
  await page.mouse.up();
}

test.describe("plugin surfaces as shell windows", () => {
  test.beforeEach(async ({ page }) => {
    await openShell(page, "?plugins=1&lang=en");
    await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
  });

  test("a UI plugin's surface opens inside a shell window", async ({ page }) => {
    await expect(window_(page)).toBeVisible();
    await expect(window_(page).locator(".surface-name")).toHaveText("Counter");
    await expect(window_(page).locator(`[data-pane][data-view="plugin:${COUNTER}"]`)).toHaveCount(
      1,
    );
    await expect(inner(page)).toBeVisible();
    await expect(frame(page).getByRole("button")).toBeVisible();
    // The runtime's grid holds nothing: the window manager placed it.
    await expect(page.locator(".desk-compositor > .desk-surface")).toHaveCount(0);
  });

  test("dragging the title bar moves it and the resize grip resizes it, as session edits", async ({
    page,
  }) => {
    const before = await box(page);
    await frame(page).getByRole("button").click();
    await expect(frame(page).getByTestId("count")).toHaveText("1");
    await dragTitle(page, 160, 90);
    const moved = await box(page);
    expect(Math.round(moved.x - before.x)).toBe(160);
    expect(Math.round(moved.y - before.y)).toBe(90);
    await expect(page.locator(".mode-chip.is-current .mode-dirty")).toBeVisible();
    const grip = window_(page).locator(".surface-resize");
    const g = await grip.boundingBox();
    if (!g) throw new Error("no grip");
    await page.mouse.move(g.x + 8, g.y + 8);
    await page.mouse.down();
    await page.mouse.move(g.x + 8 - 100, g.y + 8 - 60, { steps: 4 });
    await page.mouse.up();
    const resized = await box(page);
    expect(Math.round(moved.w - resized.width)).toBe(100);
    expect(Math.round(moved.h - resized.height)).toBe(60);
    // The plugin kept its state through the moves: its frame was never reloaded.
    await expect(frame(page).getByTestId("count")).toHaveText("1");
  });

  test("dropping it at the left edge snaps it to the left half; double-clicking the title bar fills the desk and restores", async ({
    page,
  }) => {
    const before = await box(page);
    await dragTitle(page, -(before.x - 110), 0);
    await expect(window_(page)).toHaveCSS("left", "104px");
    await expect(window_(page)).toHaveCSS("top", "72px");
    await expect(window_(page)).toHaveCSS("height", "740px");
    const snapped = await box(page);
    expect(snapped.width).toBeLessThan(700);
    await window_(page).locator(".surface-title").dblclick();
    await expect(window_(page)).toHaveCSS("width", "1232px");
    await expect(window_(page)).toHaveCSS("height", "740px");
    await window_(page).locator(".surface-title").dblclick();
    await expect(window_(page)).toHaveCSS("width", `${Math.round(snapped.width)}px`);
    await expect(window_(page)).toHaveCSS("left", "104px");
  });

  test("putting it in the drawer takes the frame away and raising it brings the plugin back", async ({
    page,
  }) => {
    await window_(page).locator('.tool[aria-label="Put in drawer"]').click();
    await expect(window_(page)).toHaveCount(0);
    await expect(page.locator(".drawer-button .badge")).toHaveText("4");
    await page.click(".drawer-button");
    await page.click(`[data-key="raise-surface-${COUNTER}"]`);
    await expect(window_(page)).toBeVisible();
    await expect(frame(page).getByRole("button")).toBeVisible();
  });

  test("turning the plugin off removes its window and on brings it back", async ({ page }) => {
    await page.evaluate(
      (id) =>
        window.__shell.stub.emit({
          event: "plugin.changed",
          data: { plugin: id, change: "disabled", revision: 1 },
        }),
      COUNTER,
    );
    await expect(window_(page)).toHaveCount(0);
    await page.evaluate(
      (id) =>
        window.__shell.stub.emit({
          event: "plugin.changed",
          data: { plugin: id, change: "enabled", revision: 1 },
        }),
      COUNTER,
    );
    await expect(window_(page)).toBeVisible();
    await expect(frame(page).getByRole("button")).toBeVisible();
  });

  test("Control+Tab reaches it and its window shows as focused", async ({ page }) => {
    await page.keyboard.press("Meta+n");
    await expect(page.locator('[data-surface="window-1"]')).toHaveClass(/is-focused/);
    await page.keyboard.press("Control+Tab");
    await step(page, 50);
    await expect(window_(page)).toHaveClass(/is-focused/);
    await expect(page.locator('[data-surface="window-1"]')).not.toHaveClass(/is-focused/);
  });
});
