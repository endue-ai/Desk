import { expect, type Page, test } from "@playwright/test";

// Following a foreign key from endue.database's grid (PG-41, #468) on the browser stub: the fixture's
// PostgreSQL connection `fixture-pg` answers the schema cache from the shop catalog, whose orders
// point at people (orders_person_fkey), and pages both tables (plugins/database/tests/
// links-fixture.ts). The person cells are drawn as links; `g` opens people filtered to the row, its
// quick filter a chip, and `b` comes back to the orders.
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
      table: "orders",
    }),
  );
  await expect(frame.locator("#page")).toHaveText("1–3");
  return frame;
}

test("a key's cells are links: g follows one to its row and b comes back", async ({ page }) => {
  const frame = await open(page);
  const links = frame.locator("#result .cell.link");
  await expect(links).toHaveText(["1", "2", "1"]);
  await expect(links.first()).toHaveAttribute(
    "title",
    "Points at public.people (id): g or Mod+click opens that row",
  );

  await links.nth(1).click();
  await page.keyboard.press("g");
  await expect(frame.locator("#status")).toHaveText("public.people where id = 2: b goes back.");
  await expect(frame.locator("#page")).toHaveText("1–1");
  await expect(frame.locator(".grid-chip")).toContainText(["id = 2"]);
  await expect(frame.locator("#result [role=gridcell]").nth(1)).toHaveText("Bob");

  await page.keyboard.press("b");
  await expect(frame.locator("#status")).toHaveText("Back to public.orders.");
  await expect(frame.locator("#page")).toHaveText("1–3");
  await expect(frame.locator("#result .cell.link")).toHaveCount(3);
});
