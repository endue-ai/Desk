import { expect, type Frame, type Page, test } from "@playwright/test";

// A paste into endue.database's grid (PG-43, #470) on the browser stub: the fixture's PostgreSQL
// connection `fixture-pg` has a scripted server on the stub's sessions (plugins/database/tests/
// fixtures-pg.ts) with one table of typed columns, public.items. Tab-separated text pasted from the caret becomes pending changes
// (two rows changed, one added), a bad value is refused with its row and column and nothing
// pending, Mod+Z takes the whole paste back, and D duplicates the cursor's row.
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
  await expect(frame.locator('[data-act="addRow"]')).toBeVisible();
  return frame;
}

/** The browser's paste event on the focused grid, as Mod+V gives it, with `text` on the clipboard. */
const paste = (frame: Frame, text: string) =>
  frame.evaluate((given) => {
    const data = new DataTransfer();
    data.setData("text/plain", given);
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  }, text);

test("a paste, a refused one, its undo and a duplicated row", async ({ page }) => {
  const frame = await open(page);
  const cell = (text: RegExp) => frame.locator("#result [role=gridcell]", { hasText: text });
  const status = frame.locator("#status");

  // From the doc of the second row: two rows changed and a third added.
  await cell(/^\{"size": 2\}$/).click();
  await paste(frame, '{"x": 1}\tf\n[2]\tf\n{"new": true}\tt\n');
  await expect(status).toHaveText(
    "Pasted 6 cells into 3 rows, 1 of them new: pending until Submit.",
  );
  await expect(frame.locator("#result .cell.changed")).toHaveText([
    '{"x": 1}',
    "[2]",
    "f",
    '{"new": true}',
    "t",
  ]);
  await expect(frame.locator("#result .grid-row.inserted")).toHaveCount(1);
  await expect(frame.locator("#changes-count")).toHaveText("3 pending changes");

  // Mod+Z in the grid takes the whole paste back.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(frame.locator("#result .cell.changed")).toHaveCount(0);
  await expect(frame.locator("#changes")).toBeHidden();

  // A bad value is refused with its row and column, and nothing becomes pending.
  await cell(/^t$/).first().click();
  await paste(frame, "f\nmaybe");
  await expect(status).toContainText("Nothing pasted: row 2, flag:");
  await expect(frame.locator("#result .cell.changed")).toHaveCount(0);

  // D duplicates the cursor's row as a pending row; its key is copied and said.
  await page.keyboard.press("Shift+D");
  await expect(status).toHaveText(
    "Duplicated 1 row as a pending row at the end. Change id before Submit: a key must differ.",
  );
  await expect(frame.locator("#result .grid-row.inserted")).toHaveCount(1);
  await expect(frame.locator("#changes-count")).toHaveText("1 pending change");
});
