import { expect, type Frame, type Page, test } from "@playwright/test";

// The value search of endue.database (plugins/database/ui/features/search) on the fixture page's
// scripted PostgreSQL connection `ledger` (plugins/database/tests/search-fixture.ts): it opens from
// its command with the estimate, the form and the results grouped by table and column lie inside
// the page at the first size and at 900×600, and a hit opens its table filtered to its row.
const SURFACE = '[data-surface="endue.database"]';
const FIRST = { width: 400, height: 263 };
const LARGE = { width: 898, height: 558 };
type Size = typeof FIRST;

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

async function open(page: Page, size: Size) {
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
  }, size);
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").first()).toContainText("fixture");
  await expect
    .poll(() => frame.evaluate(() => [innerWidth, innerHeight]))
    .toEqual([size.width, size.height]);
  return frame;
}

/** The search panel of `ledger`, searched for 4242 anywhere in a value. */
async function searched(page: Page, frame: Frame) {
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.search-data", { connection: "ledger" }),
  );
  await expect(frame.locator("#panel-box .search")).toBeVisible();
  await expect(frame.locator('[data-part="estimate"]')).toContainText("Reads 7 tables");
  await frame.getByRole("searchbox", { name: "Value to find" }).fill("4242");
  await frame.locator('select[name="match"]').selectOption("contains");
  await frame.locator('[data-ctl="search"]').click();
  await expect(frame.locator('[data-part="summary"]')).toContainText("Found 5 rows in 4 tables");
}

/** Whether the page itself scrolls, and the sides of the panel box and of the results against it. */
const layout = (frame: Frame) =>
  frame.evaluate(() => {
    const box = document.getElementById("panel-box")?.getBoundingClientRect();
    const root = document.scrollingElement;
    const parts = [
      ...document.querySelectorAll(".search-form, .search-table, .search-hit, .search-skipped"),
    ];
    return {
      scrolls: root
        ? root.scrollHeight > innerHeight + 1 || root.scrollWidth > innerWidth + 1
        : false,
      inside: box ? box.left >= -0.5 && box.right <= innerWidth + 0.5 && box.width > 0 : false,
      past: parts
        .map((el) => el.getBoundingClientRect())
        .filter((r) => box && (r.left < box.left - 0.5 || r.right > box.right + 0.5)).length,
    };
  });

for (const [name, size] of [
  ["the first size", FIRST],
  ["900×600", LARGE],
] as const) {
  test(`at ${name} the form and the grouped results lie inside the page`, async ({ page }) => {
    const frame = await open(page, size);
    await searched(page, frame);
    const seen = await layout(frame);
    expect(seen.scrolls, "the page itself scrolls").toBe(false);
    expect(seen.inside, "the panel inside the page").toBe(true);
    expect(seen.past, "parts past the panel's sides").toBe(0);
    await expect(frame.locator(".search-table")).toHaveCount(4);
    await expect(frame.locator('.search-table[data-table="public.events"]')).toContainText(
      "no primary key: rows by ctid",
    );
    await expect(frame.locator(".search-skipped li")).toHaveCount(3);
    await expect(frame.locator('.search-skipped [data-why="permission"]')).toContainText(
      "no permission to read it",
    );
  });
}

test("a hit opens the table filtered to its row", async ({ page }) => {
  const frame = await open(page, LARGE);
  await searched(page, frame);
  await frame.locator('.search-table[data-table="public.orders"] .search-hit').click();
  await expect(frame.locator("#panel-box")).toBeHidden();
  await expect(frame.locator("#result [role=gridcell]", { hasText: /^4242$/ })).toBeVisible();
  await expect(frame.locator("#result [role=gridcell]", { hasText: /^4243$/ })).toHaveCount(0);
  await expect(frame.locator("#status")).toContainText("orders: the row of id 4242.");
});
