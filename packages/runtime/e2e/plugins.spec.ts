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

test("a plugin's last state survives an update that reloads it right after it set it", async ({
  page,
}) => {
  const helloFrame = page.frameLocator(`${hello} iframe`);
  await expect(helloFrame.getByTestId("bridge")).toHaveText("bridge: ok, 0 grants");
  const plugin = page.frames().find((f) => f.url().includes("/plugins/example.hello-ui/"));
  if (!plugin) throw new Error("Hello has no frame");
  // Its page's context is known now, so the click below goes out right behind the update.
  await plugin.evaluate(() => document.readyState);

  // The update comes while the desk's thread is busy for 300 ms, as on a loaded machine, and Hello
  // counts in that time, on its page still on screen; nothing waits for its desk:state. Reloading at
  // once, the desk navigated the frame first and the message came after the page had gone, with no
  // source the desk could tell, so the reloaded Hello counted from 0. The reload now waits for the
  // frame's answer to a ping (`frames/reload.ts`).
  const update = page.evaluate(() => {
    window.__desk.stub.emit({
      event: "plugin.changed",
      data: { plugin: "example.hello-ui", change: "updated", revision: 2 },
    });
    const until = performance.now() + 300;
    while (performance.now() < until);
  });
  await plugin.evaluate(() => document.querySelector<HTMLElement>("desk-button")?.click());
  await update;
  await expect(helloFrame.getByTestId("revision")).toHaveText("revision 2");
  await expect(helloFrame.getByTestId("count")).toHaveText("1");
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
