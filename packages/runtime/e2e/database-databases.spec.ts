import { expect, type Frame, type Page, test } from "@playwright/test";

// One PostgreSQL connection shows every database of its server (PG-13, ADR 0321) on the browser
// stub: the fixture's `fixture-pg` is on shop, and its server (databases-fixture.ts) also has
// analytics and locked, which refuses. The explorer lists them under the connection, shop first
// and open; analytics' table opens on analytics and the header says so; locked says why on its own
// row; the header's database button moves the view back to shop. A desk command stands in for the
// palette: it records each title and answers the database pick with shop.
const SURFACE = '[data-surface="endue.database"]';
const LARGE = { width: 898, height: 558 };

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

async function open(page: Page) {
  await page.goto("/database.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() => {
    window.__desk.runtime.commands.define("desk.palette.pick", {
      title: "Pick",
      owner: "desk",
      run: (args) => {
        const title = String((args as { title?: string }).title);
        window.__desk.commands.push(title);
        return title.startsWith("Database: move it") ? "shop" : "";
      },
    });
  });
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
  return frame;
}

/** The explorer's row whose label is `label`. */
const row = (frame: Frame, label: string) =>
  frame
    .locator("#tree [role=treeitem]")
    .filter({ has: frame.locator(".label", { hasText: new RegExp(`^${label}$`, "u") }) })
    .first();
/** Open rows one after the other: click each, then Right. */
async function expand(page: Page, frame: Frame, ...labels: string[]) {
  for (const label of labels) {
    await row(frame, label).click();
    await page.keyboard.press("ArrowRight");
    await expect(row(frame, label)).toHaveAttribute("aria-expanded", "true");
  }
}
const labels = (frame: Frame, level: number) =>
  frame.locator(`#tree [role=treeitem][aria-level="${level}"] .label`);

test("a PostgreSQL connection lists its server's databases and switches between them", async ({
  page,
}) => {
  const frame = await open(page);
  await expand(page, frame, "fixture-pg");
  await expect(labels(frame, 2)).toHaveText(["shop", "analytics", "locked"]);
  await expect(row(frame, "shop")).toHaveAttribute("aria-expanded", "true");
  await expect(row(frame, "shop")).toContainText("the connection's");
  await expect(row(frame, "public")).toHaveAttribute("aria-level", "3");

  // Another database opens when asked, and its table opens on it.
  await expand(page, frame, "analytics", "metrics", "Tables");
  await row(frame, "visits").click();
  await page.keyboard.press("Enter");
  const database = frame.locator("#database");
  await expect(database).toBeVisible();
  await expect(database).toHaveText("analytics");
  await expect(frame.locator("#title")).toContainText("fixture-pg/analytics");
  await expect(frame.locator("#result [role=gridcell]", { hasText: "/pricing" })).toBeVisible();

  // A database that refuses says so on its own row; the others are as they were.
  await expand(page, frame, "locked");
  await expect(row(frame, "locked")).toHaveClass(/\berror\b/u);
  await expect(frame.locator("#tree")).toContainText('permission denied for database "locked"');
  await expect(row(frame, "fixture-pg")).not.toHaveClass(/\berror\b/u);
  await expect(row(frame, "public")).toBeVisible();

  // The header's database button moves the view to the database picked.
  await database.click();
  await expect
    .poll(() => page.evaluate(() => window.__desk.commands.at(-1)))
    .toBe("Database: move it to which database of fixture-pg?");
  await expect(database).toHaveText("shop");
  await expect(frame.locator("#title")).not.toContainText("/analytics");
});
