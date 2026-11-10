// The runtime as the desk's system surface (ADR 0160), the way the app runs it: no plugin's page is a
// frame of the runtime's page, which keeps only each surface's place; the fixture (system.html) plays
// the shell and the compositor, so this is the runtime's half of what e2e/specs/system-surfaces
// checks on the CEF desk.
import { expect, type Page, test } from "@playwright/test";

const ECHO = "main.test-echo";
const COUNTER = "main.test-counter";

async function open(page: Page) {
  await page.goto("/system.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
}

/** A surface's page, in the fixture's compositor layer. */
const surface = (page: Page, host: string) =>
  page.frameLocator(`#surfaces iframe[data-host="${host}"]`);

/** The message types the fixture carried for `host`, each way. */
const carried = (page: Page, host: string, to: "page" | "desk") =>
  page.evaluate(
    ([h, t]) => window.__system.posted.filter((p) => p.host === h && p.to === t).map((p) => p.type),
    [host, to] as const,
  );

test("the runtime keeps no frame in its page: each plugin surface's page is the shell's, over its place", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator("#desk [data-surface-host]")).toHaveCount(2);
  await expect(page.locator("#desk iframe")).toHaveCount(0);
  await expect(page.locator("#surfaces iframe")).toHaveCount(2);
  await expect(surface(page, COUNTER).getByTestId("count")).toHaveText("0");
  const place = await page.locator(`#desk [data-surface-host="${COUNTER}"]`).boundingBox();
  const frame = await page.locator(`#surfaces iframe[data-host="${COUNTER}"]`).boundingBox();
  expect(frame).toEqual(place);
});

test("the plugin host greets each page through the shell, by its host, and hears it back", async ({
  page,
}) => {
  await open(page);
  await expect(surface(page, ECHO).getByTestId("scheme")).not.toHaveText("none");
  await expect.poll(() => carried(page, ECHO, "desk")).toContain("desk:hello");
  expect(await carried(page, ECHO, "page")).toContain("desk:init");
  // The counter's page has no SDK and never says hello: nothing greets it.
  expect(await carried(page, COUNTER, "page")).not.toContain("desk:init");
});

test("an update loads a surface's page again, which says hello once more and nothing else reloads", async ({
  page,
}) => {
  await open(page);
  await surface(page, COUNTER).getByRole("button").click();
  await expect(surface(page, COUNTER).getByTestId("count")).toHaveText("1");
  await expect.poll(() => carried(page, ECHO, "page")).toContain("desk:init");
  const inits = async () => (await carried(page, ECHO, "page")).filter((t) => t === "desk:init");
  const before = (await inits()).length;
  await page.evaluate(() =>
    window.__desk.stub.emit({
      event: "plugin.changed",
      data: { plugin: "test.echo", change: "updated", revision: 2 },
    }),
  );
  await expect
    .poll(() => page.evaluate(() => window.__system.pages.list().find((s) => s.id === "test.echo")))
    .toMatchObject({ loads: 2, src: expect.stringContaining("v=2") });
  await expect.poll(async () => (await inits()).length).toBe(before + 1);
  await expect(surface(page, COUNTER).getByTestId("count")).toHaveText("1");
});
