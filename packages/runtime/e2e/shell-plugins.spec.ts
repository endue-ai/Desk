// Plugin surfaces as shell windows: the shell fixture with ?plugins=1 installs two UI test plugins,
// whose centre surfaces open inside the shell's windows (ADR 0040). One window manager: tiling,
// drag, resize, snap, maximize, the drawer and the plugin's on/off all go through it.
import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell, step } from "./shell-helpers";

test.use({ viewport: DESK });

const COUNTER = "test.counter";
const HELLO = "example.hello-ui";
const window_ = (page: Page, id = COUNTER) => page.locator(`section.surface[data-surface="${id}"]`);
const inner = (page: Page, id = COUNTER) => page.locator(`.desk-surface[data-surface="${id}"]`);
const frame = (page: Page, id = COUNTER) =>
  page.frameLocator(`.desk-surface[data-surface="${id}"] iframe`);
const box = async (page: Page, id = COUNTER) => {
  const b = await window_(page, id).boundingBox();
  if (!b) throw new Error(`no window ${id}`);
  return b;
};

/** Drag a window by its title bar, grabbing 120 px in from its left edge. */
async function dragTitle(page: Page, id: string, dx: number, dy: number) {
  const b = await box(page, id);
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

  test("a UI plugin's surface opens inside a shell window, tiled beside the other", async ({
    page,
  }) => {
    await expect(window_(page)).toBeVisible();
    await expect(window_(page).locator(".surface-name")).toHaveText("Counter");
    await expect(window_(page).locator(`[data-pane][data-view="plugin:${COUNTER}"]`)).toHaveCount(
      1,
    );
    await expect(inner(page)).toBeVisible();
    await expect(frame(page).getByRole("button")).toBeVisible();
    // Two unplaced windows share the free area under Eris: side by side, its whole height.
    await expect(window_(page)).toHaveCSS("left", "104px");
    await expect(window_(page)).toHaveCSS("top", "190px");
    await expect(window_(page, HELLO)).toHaveCSS("left", "726px");
    await expect(window_(page)).toHaveCSS("height", "622px");
    // The runtime's grid holds nothing but overlays: the window manager placed them.
    await expect(
      page.locator(".desk-compositor > .desk-surface:not(.desk-surface--overlay)"),
    ).toHaveCount(0);
  });

  test("the resize grip resizes it and dragging the title bar moves it, as session edits; the frame keeps its state", async ({
    page,
  }) => {
    await frame(page).getByRole("button").click();
    await expect(frame(page).getByTestId("count")).toHaveText("1");
    const before = await box(page);
    const grip = window_(page).locator('[data-resize="se"]');
    const g = await grip.boundingBox();
    if (!g) throw new Error("no grip");
    await page.mouse.move(g.x + 8, g.y + 8);
    await page.mouse.down();
    await page.mouse.move(g.x + 8 - 200, g.y + 8 - 300, { steps: 4 });
    await page.mouse.up();
    const resized = await box(page);
    expect(Math.round(before.width - resized.width)).toBe(200);
    expect(Math.round(before.height - resized.height)).toBe(300);
    await expect(page.locator(".mode-chip.is-current .mode-dirty")).toBeVisible();
    await dragTitle(page, COUNTER, 160, 90);
    const moved = await box(page);
    expect(Math.round(moved.x - resized.x)).toBe(160);
    expect(Math.round(moved.y - resized.y)).toBe(90);
    // Never reloaded: the count lives in the frame's DOM.
    await expect(frame(page).getByTestId("count")).toHaveText("1");
  });

  test("dropping it at the left edge snaps it to the left half; double-clicking the title bar fills the desk and restores", async ({
    page,
  }) => {
    const before = await box(page, HELLO);
    // The pointer, not the window, decides: it ends 6 px inside the free area's left edge.
    await dragTitle(page, HELLO, -(before.x + 120 - 110), 0);
    await expect(window_(page, HELLO)).toHaveCSS("left", "104px");
    await expect(window_(page, HELLO)).toHaveCSS("top", "190px");
    await expect(window_(page, HELLO)).toHaveCSS("width", "610px");
    await expect(window_(page, HELLO)).toHaveCSS("height", "622px");
    await window_(page, HELLO).locator(".surface-title").dblclick();
    await expect(window_(page, HELLO)).toHaveCSS("width", "1232px");
    await expect(window_(page, HELLO)).toHaveCSS("height", "622px");
    await window_(page, HELLO).locator(".surface-title").dblclick();
    await expect(window_(page, HELLO)).toHaveCSS("width", "610px");
    await expect(window_(page, HELLO)).toHaveCSS("left", "104px");
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
    await expect(window_(page, HELLO)).toHaveCSS("width", "1232px");
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
    await page.keyboard.press("Control+Tab");
    await expect(window_(page, HELLO)).toHaveClass(/is-focused/);
  });
});
