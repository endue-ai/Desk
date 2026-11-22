import { expect, type Page, test } from "@playwright/test";
import { JOIN_SQL } from "../../../plugins/database/tests/edit-joins-fixture";

// endue.database edits a join by its columns' origins (PG-45, #472) on the browser stub: the fixture's
// PostgreSQL connection `fixture-pg` answers a console's join of orders and people with each column's
// table and column number, and the catalog of both tables by OID (edit-joins-fixture.ts). A cell of
// either table changes and is drawn as pending; a computed cell says why it cannot; Preview shows
// one UPDATE per table, people (the referenced table) first; adding a row is refused for a join.
const SURFACE = '[data-surface="endue.database"]';
const SIZE = { width: 1100, height: 700 };

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
  }, SIZE);
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").nth(1)).toContainText("fixture-pg");
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.console", { connection: "fixture-pg" }),
  );
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await expect(editor).toBeVisible();
  await frame.evaluate((sql) => {
    const box = document.getElementById("editor") as HTMLTextAreaElement;
    box.value = sql;
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }, JOIN_SQL);
  await frame.locator('[data-act="run"]').click();
  await expect(frame.locator("#result [role=gridcell]", { hasText: /^Bob$/u })).toBeVisible();
  return frame;
}

test("a join's cells are edited by their tables, and the others say why", async ({ page }) => {
  const frame = await open(page);
  const cell = (text: RegExp) => frame.locator("#result [role=gridcell]", { hasText: text });

  await cell(/^Bob$/u).click();
  await page.keyboard.press("Enter");
  const text = frame.locator("input.cell-input:focus, .cell-editor :focus");
  await expect(text).toHaveCount(1);
  await text.fill("Bobby");
  await page.keyboard.press("Enter");
  await expect(frame.locator("#result .cell.changed")).toHaveText(["Bobby"]);

  await cell(/^12\.00$/u).click();
  await page.keyboard.press("Enter");
  await expect(text).toHaveCount(1);
  await text.fill("13.00");
  await page.keyboard.press("Enter");
  await expect(frame.locator("#result .cell.changed")).toHaveText(["13.00", "Bobby"]);

  // An expression belongs to no table: Enter opens its value read-only with the reason, n says it.
  const why = "twice is computed by the query, not read from a table: it cannot change.";
  await cell(/^24\.00$/u).click();
  await page.keyboard.press("Enter");
  await expect(frame.locator("#value-meta")).toContainText(`read-only: ${why}`);
  await page.keyboard.press("Escape");
  await expect(frame.locator("#value")).toBeHidden();
  await cell(/^24\.00$/u).click();
  await page.keyboard.press("n");
  await expect(frame.locator("#status")).toHaveText(why);

  await frame.locator('[data-act="addRow"]').click();
  await expect(frame.locator("#status")).toContainText(
    "Rows of a join of orders and people cannot be added",
  );

  await frame.locator('[data-act="previewChanges"]').click();
  await expect(frame.locator("#preview-sql")).toContainText(
    `UPDATE "public"."people" SET "name" = 'Bobby' WHERE "id" = 2;\nUPDATE "public"."orders" SET "total" = 13.00 WHERE "id" = 1;`,
  );
});
