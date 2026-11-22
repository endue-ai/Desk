import { expect, type Page, test } from "@playwright/test";

// A console's read larger than a page on the fixture's PostgreSQL connection (PG-22, ADR 0352):
// `fixture-pg` (plugins/database/tests/fixtures-pg.ts) answers 3,000 rows of rows_demo, which the
// console reads through a cursor on the browser stub. The summary says "at least" the rows given so
// far; scrolling the grid to its bottom brings the next pages without running the read again, and
// Count every row says the total.
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
    window.__desk.runtime.commands.run("endue.database.console", { connection: "fixture-pg" }),
  );
  return frame;
}

test("a read larger than a page scrolls on past its first page, and Count every row says the total", async ({
  page,
}) => {
  const frame = await open(page);
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await editor.click();
  await editor.fill("select n, label from rows_demo");
  await editor.press("ControlOrMeta+Enter");
  const summary = frame.locator("#summary");
  await expect(summary).toContainText("Rows 1–500 of at least 500");
  await expect(frame.locator("#result [role=gridcell]").first()).toHaveText("1");

  // Scrolled to the bottom, the grid asks for the next page, and again.
  const scroller = frame.locator("#result .scroller");
  const bottom = () => scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await bottom();
  await expect(summary).toContainText("of at least 1,000");
  await bottom();
  await expect(summary).toContainText("of at least 1,500");
  await expect(frame.locator("#result [role=gridcell]", { hasText: /^row 1500$/u })).toBeVisible();

  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.count-result-rows", {}),
  );
  await expect(summary).toContainText("of 3,000");
  // The session reads idle: the cursor's transaction is the plugin's own.
  await expect(frame.locator("#session")).toHaveText("Idle");
});
