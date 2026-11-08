import { expect, test } from "@playwright/test";

const hello = '[data-surface="example.hello-ui"]';

test.beforeEach(async ({ page }) => {
  await page.goto("/edges.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
});

test("the dock shows the plugins that open on the desk as tiles", async ({ page }) => {
  const dock = page.frameLocator('[data-surface="endue.dock"] iframe');
  const tiles = dock.getByRole("toolbar", { name: "Dock" }).getByRole("button");
  await expect(tiles).toHaveText(["HHello UI", "CCounter"]);
  await expect(tiles.first()).toHaveAttribute("aria-pressed", "true");
  await expect(tiles.last()).toHaveAttribute("aria-pressed", "true");
});

test("a tile puts its plugin away and brings it back", async ({ page }) => {
  const dock = page.frameLocator('[data-surface="endue.dock"] iframe');
  const tile = dock.getByRole("button", { name: "Hello UI" });
  await tile.click();
  await expect(page.locator(hello)).toHaveCount(0);
  await expect(tile).toHaveAttribute("aria-pressed", "false");

  await tile.click();
  await expect(page.locator(hello)).toHaveCount(1);
  await expect(tile).toHaveAttribute("aria-pressed", "true");

  const calls = await page.evaluate(() =>
    window.__desk.stub.log
      .filter((entry) => entry.request.method === "plugin.setEnabled")
      .map((entry) => [entry.caller, entry.request.params]),
  );
  const scope = { permission: "plugin:manage" };
  expect(calls).toEqual([
    ["endue.dock", { plugin: "example.hello-ui", enabled: false, scope }],
    ["endue.dock", { plugin: "example.hello-ui", enabled: true, scope }],
  ]);
});

test("arrow keys move between tiles", async ({ page }) => {
  const dock = page.frameLocator('[data-surface="endue.dock"] iframe');
  const first = dock.getByRole("button", { name: "Hello UI" });
  const second = dock.getByRole("button", { name: "Counter" });
  await expect(first).toHaveAttribute("tabindex", "0");
  await expect(second).toHaveAttribute("tabindex", "-1");
  await first.focus();
  await first.press("ArrowRight");
  await expect(second).toBeFocused();
  await second.press("ArrowRight");
  await expect(first).toBeFocused();
  await first.press("End");
  await expect(second).toBeFocused();
  await second.press("Home");
  await expect(first).toBeFocused();
});
