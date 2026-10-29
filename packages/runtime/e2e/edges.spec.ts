import { expect, type Page, test } from "@playwright/test";
import { renderTree } from "./render-tree";

async function open(page: Page) {
  await page.goto("/edges.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await expect(page.locator(".desk-surface")).toHaveCount(6);
  await page.evaluate(() => window.__desk.clock.advance(1000));
}

const box = async (page: Page, id: string) => {
  const rect = await page.locator(`[data-surface="${id}"]`).boundingBox();
  if (!rect) throw new Error(`${id} is not on the desk`);
  return rect;
};

test("the built-in plugins sit on the desk's edges and the rest on the grid", async ({ page }) => {
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

  // Edge surfaces are chrome: no title bar and no grid cell.
  await expect(page.locator('[data-surface="endue.dock"] .desk-surface-title')).toHaveCount(0);
  expect(Object.keys(await page.evaluate(() => window.__desk.runtime.layout().cells))).toEqual([
    "example.hello-ui",
    "test.counter",
  ]);
  expect(await renderTree(page)).toMatchSnapshot("edges.json");
});

test("an edge goes away with its last surface, and the grid takes the room back", async ({
  page,
}) => {
  await open(page);
  const before = await page.locator(".desk-compositor").boundingBox();
  await page.evaluate(() =>
    window.__desk.stub.emit({
      event: "plugin.changed",
      data: { plugin: "endue.dock", change: "disabled", revision: 1 },
    }),
  );
  await expect(page.locator('[data-surface="endue.dock"]')).toHaveCount(0);
  await expect(page.locator(".desk-edge--bottom")).toHaveCount(0);
  const after = await page.locator(".desk-compositor").boundingBox();
  expect(after?.height).toBeGreaterThan(before?.height ?? Number.POSITIVE_INFINITY);
  await expect(page.locator(".desk-edge--right .desk-surface")).toHaveCount(2);
});
