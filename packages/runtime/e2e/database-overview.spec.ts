import { expect, type Frame, type Page, test } from "@playwright/test";

// The server overview of endue.database (plugins/database/ui/features/overview) on the fixture
// page's scripted PostgreSQL connection `reports` (plugins/database/tests/overview-fixture.ts): it
// opens from its command, its sections lie inside the page at the first size and at 900×600, the
// settings' search narrows their rows, and Open in console brings a section's rows back as a result.
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

const overview = async (page: Page, frame: Frame) => {
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.overview", { connection: "reports" }),
  );
  await expect(frame.locator("#panel-box .overview")).toBeVisible();
  await expect(frame.locator("#ov-tables tbody tr").first()).toContainText("orders");
};

/** Whether the page itself scrolls, and the panel box's sides against the page's. */
const layout = (frame: Frame) =>
  frame.evaluate(() => {
    const box = document.getElementById("panel-box")?.getBoundingClientRect();
    const root = document.scrollingElement;
    return {
      scrolls: root
        ? root.scrollHeight > innerHeight + 1 || root.scrollWidth > innerWidth + 1
        : false,
      inside: box ? box.left >= -0.5 && box.right <= innerWidth + 0.5 && box.width > 0 : false,
      header: document.querySelector(".overview .desk-header")?.getBoundingClientRect().width ?? 0,
    };
  });

for (const [name, size] of [
  ["the first size", FIRST],
  ["900×600", LARGE],
] as const) {
  test(`at ${name} the overview's sections lie inside the page`, async ({ page }) => {
    const frame = await open(page, size);
    await overview(page, frame);
    const seen = await layout(frame);
    expect(seen.scrolls, "the page itself scrolls").toBe(false);
    expect(seen.inside, "the panel inside the page").toBe(true);
    expect(seen.header).toBeGreaterThan(0);
    await expect(frame.locator(".ov-nav a")).toHaveCount(17);
    await expect(frame.locator("#ov-unused")).toContainText("orders_note_idx");
    await expect(frame.locator("#ov-vacuum")).toContainText("38,000");
    await expect(frame.locator("#ov-statements")).toContainText("SELECT * FROM orders");
    await expect(frame.locator("#ov-server")).toContainText("Connections in use");
  });
}

test("the settings' search narrows their rows", async ({ page }) => {
  const frame = await open(page, LARGE);
  await overview(page, frame);
  const rows = frame.locator("#ov-settings tbody tr");
  await expect(rows).toHaveCount(6);
  await frame
    .getByRole("searchbox", { name: "Search the settings changed from their defaults" })
    .fill("work");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("work_mem");
});

test("Open in console brings a section's rows back as a result", async ({ page }) => {
  const frame = await open(page, LARGE);
  await overview(page, frame);
  await frame.locator("#ov-tables .ov-open").click();
  await expect(frame.getByRole("textbox", { name: "SQL" })).toBeVisible();
  await expect(frame.locator("#summary")).toContainText("Done");
  await expect(
    frame.locator("#result [role=gridcell]", { hasText: /^order_items$/ }),
  ).toBeVisible();
  await expect(frame.locator("#panel-box")).toBeHidden();
});
