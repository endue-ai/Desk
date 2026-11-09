// Plugin surfaces as shell windows: the shell fixture with ?plugins=1 installs two UI test plugins,
// whose centre surfaces open inside the shell's windows (ADR 0040). One window manager: slots,
// drag, resize, snap, maximize, the drawer and the plugin's on/off all go through it.
import { expect, type Page, test } from "@playwright/test";
import { chipsOverTitle, DESK, openShell, step } from "./shell-helpers";

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

  test("a UI plugin's surface opens inside a shell window, in the slot beside the other", async ({
    page,
  }) => {
    await expect(window_(page)).toBeVisible();
    await expect(window_(page).locator(".surface-name")).toHaveText("Counter");
    await expect(window_(page).locator(`[data-pane][data-view="plugin:${COUNTER}"]`)).toHaveCount(
      1,
    );
    await expect(inner(page)).toBeVisible();
    await expect(frame(page).getByRole("button")).toBeVisible();
    // Two unplaced windows take the first two slots under Eris: side by side, one size.
    await expect(window_(page)).toHaveCSS("left", "104px");
    await expect(window_(page)).toHaveCSS("top", "190px");
    await expect(window_(page, HELLO)).toHaveCSS("left", "518px");
    await expect(window_(page)).toHaveCSS("width", "402px");
    await expect(window_(page)).toHaveCSS("height", "305px");
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
    // Narrower than this, the title bar's tools would sit where dragTitle grabs it.
    await page.mouse.move(g.x + 8 - 60, g.y + 8 - 100, { steps: 4 });
    await page.mouse.up();
    const resized = await box(page);
    expect(Math.round(before.width - resized.width)).toBe(60);
    expect(Math.round(before.height - resized.height)).toBe(100);
    await expect(page.locator(".mode-chip.is-current .mode-dirty")).toBeVisible();
    await dragTitle(page, COUNTER, 160, 90);
    const moved = await box(page);
    expect(Math.round(moved.x - resized.x)).toBe(160);
    expect(Math.round(moved.y - resized.y)).toBe(90);
    // Never reloaded: the count lives in the frame's DOM.
    await expect(frame(page).getByTestId("count")).toHaveText("1");
    // Moving and resizing one window leaves the other where it was, at its size.
    await expect(window_(page, HELLO)).toHaveCSS("left", "518px");
    await expect(window_(page, HELLO)).toHaveCSS("width", "402px");
  });

  test("dropping it at the left edge snaps it to the left half; double-clicking the title bar fills the whole app and restores", async ({
    page,
  }) => {
    const before = await box(page, HELLO);
    const hello = `section.surface[data-surface="${HELLO}"]`;
    // The pointer, not the window, decides: it ends 10 px inside the app's left edge.
    await dragTitle(page, HELLO, -(before.x + 120 - 10), 0);
    // The left half of the whole app (ADR 0132): the bars float above it as above every window.
    await expect(window_(page, HELLO)).toHaveCSS("left", "0px");
    await expect(window_(page, HELLO)).toHaveCSS("top", "0px");
    await expect(window_(page, HELLO)).toHaveCSS("width", "714px");
    await expect(window_(page, HELLO)).toHaveCSS("height", "900px");
    expect(await chipsOverTitle(page, hello)).toEqual([]);
    await window_(page, HELLO).locator(".surface-title").dblclick();
    await expect(window_(page, HELLO)).toHaveCSS("width", "1440px");
    await expect(window_(page, HELLO)).toHaveCSS("height", "900px");
    // Its title and tools keep clear of the profile switcher and the desktops.
    expect(await chipsOverTitle(page, hello)).toEqual([]);
    await window_(page, HELLO).locator(".surface-name").dblclick();
    await expect(window_(page, HELLO)).toHaveCSS("width", "714px");
    await expect(window_(page, HELLO)).toHaveCSS("left", "0px");
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
    // The other window stays where it was, at its size.
    await expect(window_(page, HELLO)).toHaveCSS("left", "518px");
    await expect(window_(page, HELLO)).toHaveCSS("width", "402px");
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

  test("a plugin that opens one of its surfaces comes in front with the focus, from the drawer too", async ({
    page,
  }) => {
    // What the core sends the runtime when the permissions plugin raises its prompt (#17).
    const opened = (caller: string) =>
      page.evaluate(
        (id) =>
          window.__shell.stub.emit({
            event: "ui.surface.opened",
            data: { handle: "s-1", caller: id, surface: "main", placement: "center" },
          }),
        caller,
      );
    const z = (id: string) =>
      window_(page, id).evaluate((el) => Number(getComputedStyle(el).zIndex));
    await window_(page, HELLO).locator(".surface-name").click();
    await expect(window_(page, HELLO)).toHaveClass(/is-focused/);
    await opened(COUNTER);
    await expect(window_(page)).toHaveClass(/is-focused/);
    await expect(window_(page, HELLO)).not.toHaveClass(/is-focused/);
    expect(await z(COUNTER)).toBeGreaterThan(await z(HELLO));
    await window_(page).locator('.tool[aria-label="Put in drawer"]').click();
    await expect(window_(page)).toHaveCount(0);
    await opened(COUNTER);
    await expect(window_(page)).toHaveClass(/is-focused/);
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
