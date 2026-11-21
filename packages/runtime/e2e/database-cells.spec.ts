import { expect, type Page, test } from "@playwright/test";

// endue.database's typed cell editors (PG-40, #467) on the browser stub: the fixture's PostgreSQL
// connection `fixture-pg` has a scripted server (plugins/database/tests/fixtures-pg.ts) with one table
// of typed columns, public.items. Enter opens a cell's editor by its type: the enum's labels as a
// list, JSON laid out and refused when it is not JSON; what is kept is drawn as a pending change.
const SURFACE = '[data-surface="endue.database"]';
const LARGE = { width: 898, height: 558 };

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

async function open(page: Page) {
  await page.goto("/database.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.database" }),
  );
  const iframe = page.locator(`${SURFACE} iframe`);
  await expect(iframe).toBeVisible();
  await iframe.evaluate((el, { width, height }) => {
    el.style.cssText += `;width:${width}px!important;height:${height}px!important`;
  }, LARGE);
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").nth(1)).toContainText("fixture-pg");
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.open-table", {
      connection: "fixture-pg",
      schema: "public",
      table: "items",
    }),
  );
  await expect(frame.locator("#page")).toHaveText("1–3");
  // The edit target is known once the columns and their types are read.
  await expect(frame.locator('[data-act="addRow"]')).toBeVisible();
  return frame;
}

test("the enum and JSON editors on a PostgreSQL table", async ({ page }) => {
  const frame = await open(page);
  const cell = (text: RegExp) => frame.locator("#result [role=gridcell]", { hasText: text });

  await cell(/^ok$/).click();
  await page.keyboard.press("Enter");
  const list = frame.locator(".cell-editor [role=listbox]");
  await expect(list).toBeFocused();
  await expect(list.locator("[role=option]")).toHaveText(["sad", "ok", "so so"]);
  await expect(frame.locator(".cell-editor-head")).toContainText("mood");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(frame.locator(".cell-editor")).toHaveCount(0);
  await expect(frame.locator("#result .cell.changed")).toHaveText(["so so"]);

  await cell(/^\{"size": 1/).click();
  await page.keyboard.press("F2");
  const text = frame.locator(".cell-editor textarea");
  await expect(text).toBeFocused();
  await expect(text).toHaveValue('{\n  "size": 1,\n  "tags": [\n    "a"\n  ]\n}');
  await text.fill('{"size": }');
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(frame.locator(".cell-editor [role=alert]")).toContainText("line 1, column 10");
  await expect(frame.locator(".cell-editor")).toBeVisible();
  await text.fill('{"size": 3}');
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(frame.locator(".cell-editor")).toHaveCount(0);
  await expect(frame.locator("#result .cell.changed")).toHaveText(["so so", '{"size": 3}']);

  // Escape leaves a cell as it was.
  await cell(/^sad$/).click();
  await page.keyboard.press("Enter");
  await expect(list).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(frame.locator(".cell-editor")).toHaveCount(0);
  await expect(frame.locator("#result .cell.changed")).toHaveCount(2);
});
