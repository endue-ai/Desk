import { expect, test } from "@playwright/test";
import { renderTree } from "./render-tree";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.ready);
});

test("an empty desk with its status line", async ({ page }) => {
  await page.evaluate(() => window.__desk.clock.advance(1000));
  await expect(page.getByRole("status")).toHaveText("desk ready · bridge: browser");
  expect(await renderTree(page)).toMatchSnapshot("empty-desk.json");
});

test("the status line fades in on the injected clock", async ({ page }) => {
  await page.evaluate(() => window.__desk.clock.advance(120));
  expect(await renderTree(page)).toMatchSnapshot("status-fade-120ms.json");
});

test("two surfaces placed on the grid", async ({ page }) => {
  await page.evaluate(() => {
    const { runtime, clock } = window.__desk;
    runtime.openSurface({ id: "notes", title: "Notes", srcdoc: "<p>notes</p>" });
    runtime.openSurface({ id: "terminal", title: "Terminal", srcdoc: "<p>terminal</p>" });
    runtime.moveSurface("terminal", { col: 2, row: 1, colSpan: 2, rowSpan: 2 });
    clock.advance(1000);
  });
  expect(await renderTree(page)).toMatchSnapshot("two-surfaces.json");
});
