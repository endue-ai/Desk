import { expect, test } from "@playwright/test";

const hello = '[data-surface="example.hello-ui"]';
const counter = '[data-surface="test.counter"]';

test.beforeEach(async ({ page }) => {
  await page.goto("/plugins.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
});

test("an enabled UI plugin is mounted and finishes a bridge round trip", async ({ page }) => {
  const frame = page.frameLocator(`${hello} iframe`);
  await expect(frame.getByTestId("bridge")).toHaveText("bridge: ok, 0 grants");
  const log = await page.evaluate(() =>
    window.__desk.stub.log.map((entry) => [entry.caller ?? "desk", entry.request.method]),
  );
  expect(log).toContainEqual(["example.hello-ui", "perm.query"]);
  await expect(page.locator(`${hello} iframe`)).toHaveAttribute("sandbox", "allow-scripts");
});

test("a changed plugin reloads alone, within a second, and keeps its state", async ({ page }) => {
  const helloFrame = page.frameLocator(`${hello} iframe`);
  const counterFrame = page.frameLocator(`${counter} iframe`);
  await helloFrame.getByRole("button", { name: "Count" }).click();
  await expect(helloFrame.getByTestId("count")).toHaveText("1");
  await counterFrame.getByRole("button").click();
  await expect(counterFrame.getByTestId("count")).toHaveText("1");

  const started = Date.now();
  await page.evaluate(() =>
    window.__desk.stub.emit({
      event: "plugin.changed",
      data: { plugin: "example.hello-ui", change: "updated", revision: 2 },
    }),
  );
  await expect(helloFrame.getByTestId("revision")).toHaveText("revision 2");
  expect(Date.now() - started).toBeLessThan(1000);
  await expect(helloFrame.getByTestId("count")).toHaveText("1");
  await expect(counterFrame.getByTestId("count")).toHaveText("1");
});

test("disabling a plugin unmounts its surface and enabling mounts it again", async ({ page }) => {
  await page.evaluate(() =>
    window.__desk.stub.emit({
      event: "plugin.changed",
      data: { plugin: "test.counter", change: "disabled", revision: 1 },
    }),
  );
  await expect(page.locator(counter)).toHaveCount(0);
  await expect(page.locator(hello)).toHaveCount(1);
  await page.evaluate(() =>
    window.__desk.stub.emit({
      event: "plugin.changed",
      data: { plugin: "test.counter", change: "enabled", revision: 1 },
    }),
  );
  await expect(page.locator(counter)).toHaveCount(1);
});
