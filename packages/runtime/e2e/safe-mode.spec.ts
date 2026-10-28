import { expect, test } from "@playwright/test";

const hello = '[data-surface="example.hello-ui"]';
const counter = '[data-surface="test.counter"]';

test.beforeEach(async ({ page }) => {
  await page.goto("/plugins.html?safe");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
});

test("safe mode mounts built-in plugins even when they are off, and nothing else", async ({
  page,
}) => {
  await expect(page.locator(counter)).toHaveCount(1);
  await expect(page.locator(hello)).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("safe mode: only built-in plugins run");
});

test("in safe mode, plugin changes wait for the next normal start", async ({ page }) => {
  const emit = (plugin: string, change: "enabled" | "disabled") =>
    page.evaluate(
      ([plugin, change]) =>
        window.__desk.stub.emit({
          event: "plugin.changed",
          data: { plugin, change, revision: 1 },
        } as never),
      [plugin, change] as const,
    );
  await emit("test.counter", "disabled");
  await emit("example.hello-ui", "enabled");
  await expect(page.locator(counter)).toHaveCount(1);
  await expect(page.locator(hello)).toHaveCount(0);
});
