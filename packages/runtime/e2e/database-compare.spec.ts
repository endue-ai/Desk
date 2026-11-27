import { expect, type Frame, type Page, test } from "@playwright/test";

// Pinned results and two results compared (PG-26, ADR 0329) in endue.database on the browser stub:
// the fixture's SQLite connection answers `select * from stock` with one version, then another
// (plugins/database/tests/compare-fixture.ts). A result pinned from the toolbar stays as a tab after
// the next run; Run again and compare opens the panel keyed by the primary key, with its counts, the
// column only the new result has, and the changed price marked, at the page's three sizes.
const SURFACE = '[data-surface="endue.database"]';
const SIZES = [
  { width: 402, height: 305 },
  { width: 643, height: 339 },
  { width: 900, height: 600 },
];

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

async function open(page: Page, size: { width: number; height: number }) {
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
  return frame;
}

const run = (page: Page, command: string, args: Record<string, unknown> = {}) =>
  page.evaluate(
    ([command, args]) => window.__desk.runtime.commands.run(command, args).then(() => undefined),
    [command, args] as const,
  );

/** Whether the frame's page scrolls sideways. */
const overflows = (frame: Frame) =>
  frame.evaluate(() => document.documentElement.scrollWidth > innerWidth + 0.5);

for (const size of SIZES)
  test(`pin a result, run again and compare at ${size.width}×${size.height}`, async ({ page }) => {
    const frame = await open(page, size);
    await run(page, "endue.database.console", { connection: "fixture" });
    await frame.getByRole("textbox", { name: "SQL" }).fill("select * from stock");
    await run(page, "endue.database.run");
    await expect(frame.locator("#tabs [role=tab]").first()).toHaveText("Result");
    await frame.locator("#pin").click();
    const pinned = frame.locator("#tabs .tab-pinned");
    await expect(pinned).toHaveText(/^select \* from stock · \d\d:\d\d:\d\d$/u);
    await run(page, "endue.database.run");
    await expect(pinned).toHaveCount(1);

    await frame.locator("#tabs [role=tab]").first().click();
    await run(page, "endue.database.run-again-and-compare");
    const panel = frame.locator(".compare");
    await expect(panel.locator(".compare-count")).toHaveText(
      /^Compared by the primary key \(id\): \d changed, \d added, \d removed, \d the same\.$/u,
    );
    await expect(panel.locator("tbody tr")).toHaveCount(3);
    expect(await overflows(frame)).toBe(false);
  });

test("the panel marks the changed cell and says the column only one result has", async ({
  page,
}) => {
  const frame = await open(page, SIZES[2] ?? { width: 900, height: 600 });
  await run(page, "endue.database.console", { connection: "fixture" });
  await frame.getByRole("textbox", { name: "SQL" }).fill("select * from stock");
  await run(page, "endue.database.run");
  await run(page, "endue.database.run-again-and-compare");
  const panel = frame.locator(".compare");
  await expect(panel.locator(".compare-count")).toHaveText(
    "Compared by the primary key (id): 1 changed, 1 added, 1 removed, 2 the same.",
  );
  await expect(panel.locator(".compare-columns")).toHaveText("Only after: shelf. Not compared.");
  const cell = panel.locator(".compare-changed .compare-cell");
  await expect(cell).toHaveAttribute("aria-label", "price: 4.75, now 4.95");
  await expect(panel.locator(".compare-added")).toContainText("tape");
  await expect(panel.locator(".compare-removed")).toContainText("pad");
});
