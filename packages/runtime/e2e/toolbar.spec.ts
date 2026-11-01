import { expect, type FrameLocator, type Page, test } from "@playwright/test";

async function open(page: Page, query = ""): Promise<FrameLocator> {
  await page.goto(`/edges.html${query}`);
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  return page.frameLocator('[data-surface="endue.toolbar"] iframe');
}

test("the drawers open from the keyboard, one at a time", async ({ page }) => {
  const bar = await open(page);
  const plugins = bar.getByRole("button", { name: /^Plugins/ });
  const access = bar.getByRole("button", { name: /^Access/ });
  await expect(plugins).toContainText("6 on");
  await expect(access).toContainText("3 permissions");
  await expect(plugins).toHaveAttribute("aria-expanded", "false");

  await plugins.focus();
  await plugins.press("Enter");
  await expect(plugins).toHaveAttribute("aria-expanded", "true");
  await expect(bar.getByRole("region", { name: /^Plugins/ })).toContainText("Every plugin is on.");

  await access.press("Space");
  await expect(access).toHaveAttribute("aria-expanded", "true");
  await expect(plugins).toHaveAttribute("aria-expanded", "false");
  const region = bar.getByRole("region", { name: /^Access/ });
  await expect(region).toContainText("Talk to the brain");
  await expect(region).toContainText("Read files");
  await expect(region).toContainText("Eris (${home}/**)");
  await expect(region).toContainText("Manage plugins");
  await expect(region).toContainText("Dock, Plugins, Status");

  await access.press("Enter");
  await expect(access).toHaveAttribute("aria-expanded", "false");
  await expect(bar.getByRole("region")).toHaveCount(0);
});

test("a plugin that fails shows up in the Plugins drawer with a warning", async ({ page }) => {
  const bar = await open(page);
  const plugins = bar.getByRole("button", { name: /^Plugins/ });
  await expect(plugins).not.toHaveClass(/warning/);
  await page.evaluate(() => {
    const counter = window.__deskPlugins.find((p) => p.id === "test.counter");
    if (counter) Object.assign(counter, { status: "failed", error: "entry is missing" });
    window.__desk.stub.emit({
      event: "plugin.changed",
      data: { plugin: "test.counter", change: "updated", revision: 2 },
    });
  });
  await expect(plugins).toContainText("5 on · 1 failed");
  await expect(plugins).toHaveClass(/warning/);
  await plugins.click();
  const region = bar.getByRole("region", { name: /^Plugins/ });
  await expect(region.getByRole("listitem")).toHaveCount(1);
  await expect(region.getByRole("listitem")).toContainText("Counter");
  await expect(region.getByRole("listitem")).toContainText("entry is missing");
});

test("the open drawer survives a reload of the toolbar", async ({ page }) => {
  const bar = await open(page);
  await bar.getByRole("button", { name: /^Access/ }).click();
  await page.evaluate(() =>
    window.__desk.stub.emit({
      event: "plugin.changed",
      data: { plugin: "endue.toolbar", change: "updated", revision: 2 },
    }),
  );
  await expect(page.locator('[data-surface="endue.toolbar"] iframe')).toHaveAttribute(
    "src",
    /v=2$/,
  );
  await expect(bar.getByRole("button", { name: /^Access/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});
