// A plugin's setting changed in Settings › Plugins reaches the plugin (#570): the fixture's echo
// page shows its setting `loud` as ctx.settings.get answers it and as settings.changed tells it.
import { expect, type Page, test } from "@playwright/test";

const echo = (page: Page) => page.frameLocator('[data-surface="test.echo"] iframe');
const dialog = (page: Page) => page.locator(".desk-settings");

test("a value set in Settings › Plugins is what the plugin reads, and Reset takes it back", async ({
  page,
}) => {
  await page.goto("/desk.html?platform=mac&lang=en");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await expect(echo(page).getByTestId("loud")).toHaveText("unset");
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.settings.open", { section: "plugins" }),
  );
  const box = dialog(page).getByRole("checkbox", { name: "Loud" });
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(echo(page).getByTestId("loud")).toHaveText("true");
  await dialog(page).locator('[data-key="reset-test.echo.loud"]').click();
  await expect(echo(page).getByTestId("loud")).toHaveText("false");
  await expect(box).not.toBeChecked();
});

test("a plugin page that loads after the change reads the person's value", async ({ page }) => {
  await page.goto("/desk.html?platform=mac&lang=en");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.settings.open", { section: "plugins" }),
  );
  await dialog(page).getByRole("checkbox", { name: "Loud" }).check();
  await page.keyboard.press("Escape");
  // The page loads again, as after an update: it reads the setting through settings.get.
  await echo(page)
    .locator("body")
    .evaluate(() => location.reload());
  await expect(echo(page).getByTestId("loud")).toHaveText("true");
});
