import { expect, type Page, test } from "@playwright/test";
import { renderTree } from "./render-tree";

async function open(page: Page, query = "") {
  await page.goto(`/edges.html${query}`);
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await expect(page.locator(".desk-surface")).toHaveCount(query ? 7 : 6);
  await page.evaluate(() => window.__desk.clock.advance(1000));
}

const box = async (page: Page, id: string) => {
  const rect = await page.locator(`[data-surface="${id}"]`).boundingBox();
  if (!rect) throw new Error(`${id} is not on the desk`);
  return rect;
};

test("the built-in plugins sit on the desk's edges and the rest side by side", async ({ page }) => {
  await open(page);
  const sidebar = await box(page, "endue.sidebar");
  const eris = await box(page, "endue.eris");
  const toolbar = await box(page, "endue.toolbar");
  const dock = await box(page, "endue.dock");
  const hello = await box(page, "example.hello-ui");

  // Left and right edges run the full height; the dock sits between them, under the grid.
  expect(sidebar.x).toBeLessThan(hello.x);
  expect(eris.x).toBeGreaterThan(hello.x + hello.width);
  expect(toolbar.x).toBe(eris.x);
  expect(toolbar.y).toBeGreaterThan(eris.y);
  expect(dock.y).toBeGreaterThan(hello.y + hello.height);
  expect(dock.x).toBeGreaterThan(sidebar.x + sidebar.width);
  expect(dock.x + dock.width).toBeLessThan(eris.x);

  // Edge surfaces are chrome: no title bar, and not among the surfaces between the edges.
  await expect(page.locator('[data-surface="endue.dock"] .desk-surface-title')).toHaveCount(0);
  const between = await page.evaluate(() =>
    [
      ...document.querySelectorAll(".desk-surfaces > .desk-surface:not(.desk-surface--overlay)"),
    ].map((s) => (s as HTMLElement).dataset.surface),
  );
  expect(between).toEqual(["example.hello-ui", "test.counter"]);
  expect(await renderTree(page)).toMatchSnapshot("edges.json");
});

test("an edge goes away with its last surface, and the surfaces take the room back", async ({
  page,
}) => {
  await open(page);
  const before = await page.locator(".desk-surfaces").boundingBox();
  await page.evaluate(() =>
    window.__desk.stub.emit({
      event: "plugin.changed",
      data: { plugin: "endue.dock", change: "disabled", revision: 1 },
    }),
  );
  await expect(page.locator('[data-surface="endue.dock"]')).toHaveCount(0);
  await expect(page.locator(".desk-edge--bottom")).toHaveCount(0);
  const after = await page.locator(".desk-surfaces").boundingBox();
  expect(after?.height).toBeGreaterThan(before?.height ?? Number.POSITIVE_INFINITY);
  await expect(page.locator(".desk-edge--right .desk-surface")).toHaveCount(2);
});

test("a plugin named in desk.roles takes its edge's place alone, and turning it off removes that edge", async ({
  page,
}) => {
  await open(page, "?roles=1");
  // Nobody named: every enabled provider of role:dock mounts, as before roles.
  await expect(page.locator('.desk-edge--bottom [data-surface="endue.dock"]')).toHaveCount(1);
  await expect(page.locator('.desk-edge--bottom [data-surface="test.dock"]')).toHaveCount(1);

  await page.evaluate(() =>
    window.__desk.runtime.settings.set("desk.roles", { "role:dock": "test.dock" }),
  );
  await expect(page.locator('[data-surface="endue.dock"]')).toHaveCount(0);
  await expect(page.locator('.desk-edge--bottom [data-surface="test.dock"]')).toHaveCount(1);

  // The named provider turned off: its edge goes, and the other provider does not come back.
  await page.evaluate(async () => {
    const info = window.__deskPlugins.find((p) => p.id === "test.dock");
    if (info) info.enabled = false;
    window.__desk.stub.emit({
      event: "plugin.changed",
      data: { plugin: "test.dock", change: "disabled", revision: 1 },
    });
  });
  await expect(page.locator(".desk-edge--bottom")).toHaveCount(0);
  await expect(page.locator('[data-surface="endue.dock"]')).toHaveCount(0);

  // Naming nobody again gives the role back to whoever is enabled.
  await page.evaluate(() => window.__desk.runtime.settings.set("desk.roles", {}));
  await expect(page.locator('.desk-edge--bottom [data-surface="endue.dock"]')).toHaveCount(1);
});
