import { expect, test } from "@playwright/test";

test("a moved surface is restored to its cell after a reload", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(async () => {
    const { runtime } = window.__desk;
    await runtime.ready;
    runtime.openSurface({ id: "notes", title: "Notes", srcdoc: "<p>notes</p>" });
    runtime.moveSurface("notes", { col: 3, row: 2, colSpan: 1, rowSpan: 1 });
  });

  await page.reload();
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(async () => {
    const { runtime } = window.__desk;
    await runtime.ready;
    runtime.openSurface({ id: "notes", title: "Notes", srcdoc: "<p>notes</p>" });
  });

  const surface = page.locator('[data-surface="notes"]');
  await expect(surface).toHaveCSS("grid-column-start", "3");
  await expect(surface).toHaveCSS("grid-row-start", "2");
  expect(await page.evaluate(() => window.__desk.runtime.layout().cells.notes)).toEqual({
    col: 3,
    row: 2,
    colSpan: 1,
    rowSpan: 1,
  });
});
