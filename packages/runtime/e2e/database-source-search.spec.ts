import { expect, type Frame, type Page, test } from "@playwright/test";

// The source search of endue.database (plugins/database/ui/features/source-search) on the fixture
// page's scripted PostgreSQL connection `ledger` (plugins/database/tests/source-search-fixture.ts):
// it opens from its command, finds the routine, view and table parts that mention `customer` with
// their lines, the form and the results lie inside the page at the first size and at 900×600, and a
// line opens the routine's source with that line selected.
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

/** The source search panel of `ledger`, searched for `customer`. */
async function searched(page: Page, frame: Frame) {
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.search-source", { connection: "ledger" }),
  );
  await expect(frame.locator("#panel-box .src")).toBeVisible();
  await frame.getByRole("searchbox", { name: "Text to find" }).fill("customer");
  await frame.locator('.src [data-ctl="search"]').click();
  await expect(frame.locator('.src [data-part="summary"]')).toContainText(
    "Found 8 lines in 6 objects of 2 schemas",
  );
}

/** Whether the page itself scrolls, and how many parts reach past the panel box's sides. */
const layout = (frame: Frame) =>
  frame.evaluate(() => {
    const box = document.getElementById("panel-box")?.getBoundingClientRect();
    const root = document.scrollingElement;
    const parts = [...document.querySelectorAll(".src-form, .src-object, .src-line")];
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
  test(`at ${name} the form and the results lie inside the page`, async ({ page }) => {
    const frame = await open(page, size);
    await searched(page, frame);
    const seen = await layout(frame);
    expect(seen.scrolls, "the page itself scrolls").toBe(false);
    expect(seen.inside, "the panel inside the page").toBe(true);
    expect(seen.past, "parts past the panel's sides").toBe(0);
    await expect(frame.locator(".src-object")).toHaveCount(6);
    // USING ((customer = current_customer())): both are marked.
    await expect(
      frame.locator('.src-object[data-object="policy public.orders.own_orders"] .src-mark'),
    ).toHaveText(["customer", "customer"]);
  });
}

test("a line opens the routine's source with that line selected", async ({ page }) => {
  const frame = await open(page, LARGE);
  await searched(page, frame);
  const fn = frame.locator('.src-object[data-object^="function public.order_total"]');
  await fn.locator(".src-line", { hasText: "SELECT sum(total)" }).click();
  await expect(frame.locator("#panel-box")).toBeHidden();
  await expect(frame.locator("#status")).toContainText(
    "order_total(customer integer): line 7 of its source.",
  );
  await expect
    .poll(() => frame.evaluate(() => getSelection()?.toString() ?? ""))
    .toContain("WHERE o.customer = $1");
});
