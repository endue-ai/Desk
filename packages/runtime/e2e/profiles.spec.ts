import { expect, type Page, test } from "@playwright/test";

const echo = (page: Page) => page.frameLocator('[data-surface="test.echo"] iframe');
const palette = (page: Page) => page.frameLocator('[data-surface="desk.palette"] iframe');
const status = (page: Page) => page.locator(".desk-status");
const setting = (page: Page, key: string) =>
  page.evaluate((key) => window.__desk.runtime.settings.get(key), key);

async function open(page: Page, query = "") {
  await page.goto(`/desk.html${query}`);
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await expect(echo(page).getByTestId("scheme")).not.toHaveText("none");
}

const setEnabled = (page: Page, plugin: string, enabled: boolean) =>
  page.evaluate(
    ([plugin, enabled]) =>
      window.__desk.stub.call({
        id: 900,
        method: "plugin.setEnabled",
        params: {
          plugin: plugin as string,
          enabled: enabled as boolean,
          scope: { permission: "plugin:manage" },
        },
      }),
    [plugin, enabled] as const,
  );

test.describe("desk.profiles", () => {
  test("the profile init.yaml names applies at start", async ({ page }) => {
    await open(page, "?profile=focus");
    expect(await setting(page, "desk.notify.dnd")).toBe(true);
    await echo(page).getByTestId("notify").click();
    await page.waitForTimeout(100);
    await expect(status(page)).not.toHaveText(/Hello from echo/);
  });

  test("a profile init.yaml names but nobody has is reported", async ({ page }) => {
    await open(page, "?profile=nope");
    await expect(status(page)).toHaveText("No profile nope — init.yaml names it.");
  });

  test("Mod+Shift+M switches profiles through the palette", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Control+Shift+M");
    await expect(palette(page).getByTestId("query")).toBeFocused();
    await page.keyboard.type("present");
    await page.keyboard.press("Enter");
    await expect(status(page)).toHaveText("Profile: Presenting");
    await expect
      .poll(() => page.evaluate(() => document.querySelector<HTMLElement>("#desk")?.dataset.scheme))
      .toBe("light");
    expect(await setting(page, "desk.theme.contrast")).toBe("high");
  });

  test("a saved profile keeps which plugins are on, and switching back applies it", async ({
    page,
  }) => {
    await open(page);
    await setEnabled(page, "test.counter", false);
    await expect(page.locator('[data-surface="test.counter"]')).toHaveCount(0);
    await page.evaluate(() =>
      window.__desk.runtime.commands.run("desk.profiles.save", { id: "quiet", name: "Quiet" }),
    );
    expect(await page.evaluate(() => window.__deskStore.profiles)).toEqual([
      expect.objectContaining({
        id: "quiet",
        name: "Quiet",
        plugins: expect.objectContaining({ disabled: ["test.counter"] }),
      }),
    ]);
    await setEnabled(page, "test.counter", true);
    await expect(page.locator('[data-surface="test.counter"]')).toHaveCount(1);
    await page.evaluate(() =>
      window.__desk.runtime.commands.run("desk.profiles.switch", { id: "quiet" }),
    );
    await expect(page.locator('[data-surface="test.counter"]')).toHaveCount(0);
    await expect(status(page)).toHaveText("Profile: Quiet");
  });
});
