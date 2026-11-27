import { expect, type Frame, type Page, test } from "@playwright/test";

// The agent audit in endue.database (plugins/database/ui/features/audit/) on the fixture's SQLite
// connection `fixture` (plugins/database/tests/fixtures.ts: people Ada, Bob, Cy, Dee): a table's
// sample rows taken through the agents' tool land on the connection's audit list, a column marked
// sensitive in the panel comes back masked in the next sample, and closing the connection to agents
// shows in the panel. The desk runs the tool here, so it is the palette's call on the list.
const SURFACE = '[data-surface="endue.database"]';
const SIZE = { width: 900, height: 600 };

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

const iframe = (page: Page) => page.locator(`${SURFACE} iframe`);

async function open(page: Page) {
  await page.goto("/database.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.database" }),
  );
  await expect(iframe(page)).toBeVisible();
  await iframe(page).evaluate((el, { width, height }) => {
    el.style.cssText += `;width:${width}px!important;height:${height}px!important`;
  }, SIZE);
  const frame = await (await iframe(page).elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").first()).toContainText("fixture");
  return frame;
}

const run = (page: Page, id: string, args: Record<string, unknown>) =>
  page.evaluate(([id, args]) => window.__desk.runtime.commands.run(id, args), [id, args] as const);

const sample = (page: Page) =>
  run(page, "endue.database.sample-rows", { connection: "fixture", table: "people" }) as Promise<{
    rows: string[][];
    masked: string[];
  }>;

test("a sample lands on the audit list, a sensitive column is masked, and the connection closes to agents", async ({
  page,
}) => {
  const frame: Frame = await open(page);
  const first = await sample(page);
  expect(first.rows.map((r) => r[1])).toEqual(["Ada", "Bob", "Cy", "Dee"]);
  await run(page, "endue.database.agent-audit", { connection: "fixture" });
  const rows = frame.locator("#panel-box .audit-table tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('SELECT * FROM "people" LIMIT 20 OFFSET 0');
  await expect(rows.first()).toContainText("You (palette)");

  await frame.locator('#panel-box [data-ctl="sensitive"]').fill("people.note");
  await frame.locator('#panel-box [data-ctl="add"]').click();
  await expect(frame.locator("#panel-box .audit-chips")).toContainText("people.note");
  const second = await sample(page);
  expect(second.masked).toEqual(["note"]);
  expect(second.rows.map((r) => r[2])).toEqual(["(masked)", "(masked)", "(masked)", "(masked)"]);
  await expect(rows).toHaveCount(2);

  await frame.locator('#panel-box [data-ctl="closed"]').check();
  await expect(frame.locator('#panel-box [role="status"]')).toHaveText(
    "fixture is closed to agents.",
  );
  await expect(frame.locator('#panel-box [data-ctl="closed"]')).toBeChecked();
});
