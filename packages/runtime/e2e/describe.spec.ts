import { expect, type Page, test } from "@playwright/test";

const palette = '[data-surface="desk.palette"]';
const frame = (page: Page) => page.frameLocator(`${palette} iframe`);
const dialog = ".desk-describe";

/** The bare desk with init.yaml setting the scheme, once the palette answers. */
async function open(page: Page) {
  await page.goto(`/desk.html?init=${encodeURIComponent('{"desk.theme.scheme":"light"}')}`);
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await expect
    .poll(() => page.evaluate(() => window.__desk.runtime.commands.has("desk.palette.pick")))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__desk.runtime.commands.has("desk.describe.open")))
    .toBe(true);
}

test.describe("desk.describe", () => {
  test("Control+Shift+/ then Control+S describes the key, and Escape closes it", async ({
    page,
  }) => {
    await open(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+Shift+Slash");
    await expect(page.locator(palette)).toBeVisible();
    await expect(frame(page).getByTestId("title")).toHaveText(/Describe/);
    await page.keyboard.press("Control+s");
    await expect(page.locator(dialog)).toBeVisible();
    await expect(page.locator(palette)).toBeHidden();
    await expect(page.locator(dialog)).toContainText("Ctrl+S runs desk.files.save.");
    await expect(page.locator(dialog)).toContainText("Layer: core default, desk");
    await page.keyboard.press("Escape");
    await expect(page.locator(dialog)).toBeHidden();
  });

  test("Describe… from the palette describes a picked setting with its layer", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Control+K");
    await page.keyboard.type("Describe");
    await expect(frame(page).getByRole("option").first()).toContainText("Describe");
    await page.keyboard.press("Enter");
    await expect(frame(page).getByTestId("title")).toHaveText(/Describe/);
    await page.keyboard.type("desk.theme.scheme");
    await page.keyboard.press("Enter");
    await expect(page.locator(dialog)).toBeVisible();
    await expect(page.locator(dialog)).toContainText(
      'desk.theme.scheme is "light", set in init.yaml.',
    );
    await expect(page.locator(dialog)).toContainText(
      'Layers: manifest default "dark"; init.yaml "light"',
    );
    await page.locator(dialog).getByRole("button", { name: "Copy" }).click();
    await expect(page.locator(`${dialog} [role="status"]`)).toHaveText(/Copied|clipboard/);
    await page.locator(dialog).getByRole("button", { name: "Close" }).click();
    await expect(page.locator(dialog)).toBeHidden();
  });
});
