// Closing a plugin's window by its × with unsaved changes asks what ⌘W asks (#160, #162): the
// shell fixture's counter marks its surface changed, as a file plugin marks the file it holds
// (desk.buffers.update), and the window's × goes through desk.buffers' guard first.
import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });

const COUNTER = "test.counter";
const window_ = (page: Page) => page.locator(`section.surface[data-surface="${COUNTER}"]`);
const close = (page: Page) => window_(page).locator('.tool[aria-label="Close"]').click();
const palette = (page: Page) => page.frameLocator('[data-surface="desk.palette"] iframe');
/** The palette is up with the question, its query taking the keys. */
async function asked(page: Page): Promise<void> {
  await expect(page.locator('[data-surface="desk.palette"]')).toBeVisible();
  await expect(palette(page).getByTestId("title")).toHaveText("Counter has unsaved changes");
  await expect(palette(page).getByTestId("query")).toBeFocused();
}
const changed = (page: Page, modified: boolean) =>
  page.evaluate(
    ([id, modified]) =>
      window.__shell.desk.runtime.commands.run("desk.buffers.update", {
        id: `surface:${id}`,
        modified,
      }),
    [COUNTER, modified] as const,
  );

test.beforeEach(async ({ page }) => {
  await openShell(page, "?plugins=1&lang=en");
  await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
  await expect
    .poll(() => page.evaluate(() => window.__shell.desk.runtime.commands.has("desk.palette.pick")))
    .toBe(true);
});

test("the × of a window with unsaved changes asks; Keep it open keeps the window", async ({
  page,
}) => {
  await changed(page, true);
  await close(page);
  await asked(page);
  await expect(palette(page).getByRole("option")).toHaveText([
    "Save, then close",
    "Close without saving",
    "Keep it open",
  ]);
  await page.keyboard.type("keep");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-surface="desk.palette"]')).toBeHidden();
  await expect(window_(page)).toBeVisible();
  // Asked again, the person lets the changes go: the window closes.
  await close(page);
  await asked(page);
  await page.keyboard.type("without");
  await page.keyboard.press("Enter");
  await expect(window_(page)).toHaveCount(0);
});

test("the × of a window with nothing unsaved closes it at once", async ({ page }) => {
  await changed(page, false);
  await close(page);
  await expect(window_(page)).toHaveCount(0);
  await expect(page.locator('[data-surface="desk.palette"]')).toBeHidden();
});
