import { expect, type Frame, type Page, test } from "@playwright/test";

// A result's totals and its chart (PG-44, plugins/database/ui/chart/) on the browser stub with the
// scripted sqlite3 over the fixture's staff table (id, name, note, team): a block of the grid shows
// its count, distinct count, sum, average, minimum and maximum in the footer; the Chart button opens
// a Chart tab that draws the ids summed by team as bars in the theme's chart colours, with a table
// for screen readers, and draws again as a pie; and the chart exports as a PNG.
const SURFACE = '[data-surface="endue.database"]';

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
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").first()).toContainText("fixture");
  return frame;
}

const run = (page: Page, command: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([command, args]) => window.__desk.runtime.commands.run(command, args), [
    command,
    args,
  ] as const);

async function query(page: Page, frame: Frame) {
  await run(page, "endue.database.console", { connection: "fixture" });
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await editor.click();
  await editor.fill("select * from staff;");
  await editor.press("ControlOrMeta+Enter");
  await expect(frame.locator("#summary")).toContainText("Done");
  await expect(frame.locator("#result [role=gridcell]").first()).toHaveText("1");
}

test("a block of the grid shows its totals in the footer", async ({ page }) => {
  const frame = await open(page);
  await query(page, frame);
  await frame.locator("#result [role=gridcell]").first().click();
  for (let i = 0; i < 3; i++) await frame.locator("#result [role=grid]").press("Shift+ArrowDown");
  await expect(frame.locator("#totals")).toHaveText(
    "Count 4 · Distinct 4 · Sum 10 · Average 2.5 · Min 1 · Max 4",
  );
  await frame.locator("#result [role=grid]").press("ArrowRight");
  await expect(frame.locator("#totals")).toHaveText("");
});

test("a result is drawn as a chart, read as a table, and exported as an image", async ({
  page,
}) => {
  const frame = await open(page);
  await query(page, frame);
  await frame.getByRole("button", { name: "Chart", exact: true }).click();
  await expect(frame.getByRole("tab", { name: "Chart" })).toHaveAttribute("aria-selected", "true");
  const chart = frame.locator("#result svg[role=img]");
  await expect(chart).toHaveAttribute("aria-label", "Bar chart of the sum of id by name");
  // The first text column is the name: pick the team.
  await frame.locator('#result select[name="x"]').selectOption("team");
  await expect(chart).toHaveAttribute("aria-label", "Bar chart of the sum of id by team");
  await expect(frame.locator("#result rect.chart-bar")).toHaveCount(2);
  const fill = await frame
    .locator("#result rect.chart-bar")
    .first()
    .evaluate((bar) => getComputedStyle(bar).fill);
  const token = await frame.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--desk-chart-1)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(fill).toBe(token);
  const table = await frame
    .locator("#result table.sr-only tr")
    .evaluateAll((rows) =>
      rows.map((row) => [...row.children].map((cell) => cell.textContent ?? "")),
    );
  expect(table).toEqual([
    ["team", "id"],
    ["red", "4"],
    ["blue", "6"],
  ]);
  await frame.locator('#result select[name="type"]').selectOption("pie");
  await expect(frame.locator("#result path.chart-slice")).toHaveCount(2);

  await frame.locator("#result button[data-chart=export]").click();
  await expect(frame.locator("#status")).toContainText("Exported the chart as PNG to ~/Pictures/");
});
