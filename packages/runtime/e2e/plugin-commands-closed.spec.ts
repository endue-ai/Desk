// A plugin whose window the person closed keeps its commands and keys (#565): they stay in the
// palette, and running one opens the window again. The fixture's terminal (shell.html?apps=1) is
// the counter's page under the terminal's id, with its two commands and its key Mod+Shift+T (⌘ on the shell).
import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });

const ID = "endue.terminal";
const window_ = (page: Page) => page.locator(`section.surface[data-surface="${ID}"]`);
const palette = '[data-surface="desk.palette"]';
const frame = (page: Page) => page.frameLocator(`${palette} iframe`);

test.beforeEach(async ({ page }) => {
  await openShell(page, "?apps=1&lang=en");
  await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
  await expect
    .poll(() => page.evaluate(() => window.__shell.desk.runtime.commands.has("desk.palette.open")))
    .toBe(true);
  await expect(window_(page)).toBeVisible();
  await window_(page).locator('.tool[aria-label="Close"]').click();
  await expect(window_(page)).toHaveCount(0);
});

test("a closed plugin's command stays in the palette and opens its window", async ({ page }) => {
  await page.keyboard.press("Meta+k");
  await expect(frame(page).getByTestId("query")).toBeFocused();
  await page.keyboard.type("New terminal");
  await expect(frame(page).getByRole("option").first()).toContainText("New terminal");
  await page.keyboard.press("Enter");
  await expect(page.locator(palette)).toBeHidden();
  await expect(window_(page)).toBeVisible();
});

test("a closed plugin's key opens its window", async ({ page }) => {
  await page.keyboard.press("Meta+Shift+T");
  await expect(window_(page)).toBeVisible();
});
