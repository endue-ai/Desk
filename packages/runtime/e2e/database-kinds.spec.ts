import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.database's other PostgreSQL kinds (PG-50, #474) on the browser stub: the fixture's
// PostgreSQL connection `fixture-pg` answers the schema cache from the shop catalog
// (plugins/database/tests/pg-catalog.ts), so its explorer shows a schema's Types, Aggregates,
// Operators, Collations and Text search, a table's Partitions and Policies, and the connection's
// Database and Server rows; d on a type opens its DDL, read-only.
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
  return frame;
}

/** The explorer's row whose label is `label`, the `nth` of them. */
const row = (frame: Frame, label: string, nth = 0) =>
  frame
    .locator("#tree [role=treeitem]")
    .filter({ has: frame.locator(".label", { hasText: new RegExp(`^${label}$`, "u") }) })
    .nth(nth);
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

test("the explorer of a PostgreSQL connection shows every kind", async ({ page }) => {
  const frame = await open(page);
  await expand(page, frame, "fixture-pg");
  await expect(row(frame, "Database")).toBeVisible();
  await expect(row(frame, "Server")).toBeVisible();

  await expand(page, frame, "public");
  const folders = await labels(frame, 3).allTextContents();
  expect(folders).toEqual(
    expect.arrayContaining(["Types", "Aggregates", "Operators", "Collations", "Text search"]),
  );
  await expand(page, frame, "Types");
  await expect(row(frame, "mood")).toContainText("enum");

  // A table's own folders: partitions with their bounds, its policies.
  await expand(page, frame, "Tables", "events", "Partitions");
  await expect(row(frame, "events_rest")).toContainText("DEFAULT");
  await expand(page, frame, "people");
  await expect(row(frame, "Policies")).toBeVisible();
  await expect(row(frame, "people", 0)).toContainText("RLS on");

  await expand(page, frame, "Database", "Extensions");
  await expect(row(frame, "plpgsql")).toContainText("1.0");
  await expand(page, frame, "Server", "Roles");
  await expect(row(frame, "reader")).toBeVisible();

  // d on a type opens its DDL in a view that does not run.
  await row(frame, "mood").click();
  await page.keyboard.press("d");
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await expect(editor).toContainText('CREATE TYPE "public"."mood" AS ENUM');
  await expect(editor).toHaveAttribute("aria-readonly", "true");
});
