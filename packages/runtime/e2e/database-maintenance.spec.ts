import { expect, type Frame, type Page, test } from "@playwright/test";

// The maintenance form of endue.database (plugins/database/ui/features/maintenance/) on the
// fixture's scripted PostgreSQL connection `warehouse` (plugins/database/tests/maintenance-fixture.ts):
// the operations, the statement, what it locks and the size inside the page at two sizes, FULL
// turning the words into a warning, and a VACUUM run from the form with Mod+Enter that shows the
// server's output and the statistics before and after.
const SURFACE = '[data-surface="endue.database"]';
const FIRST = { width: 400, height: 263 };
const LARGE = { width: 898, height: 558 };
type Size = typeof FIRST;
type Box = { left: number; top: number; right: number; bottom: number };

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

const iframe = (page: Page) => page.locator(`${SURFACE} iframe`);
const resize = (page: Page, { width, height }: Size) =>
  iframe(page).evaluate(
    (el, { width, height }) => {
      el.style.cssText += `;width:${width}px!important;height:${height}px!important`;
    },
    { width, height },
  );

/** Open the fixture page and endue.database at `size`, resolving with its frame once the tree shows. */
async function open(page: Page, size: Size) {
  await page.goto("/database.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.database" }),
  );
  await expect(iframe(page)).toBeVisible();
  await resize(page, size);
  const frame = await (await iframe(page).elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").first()).toContainText("fixture");
  await expect
    .poll(() => frame.evaluate(() => [innerWidth, innerHeight]))
    .toEqual([size.width, size.height]);
  return frame;
}

/** The maintenance form of warehouse's public.orders, read once. */
async function form(page: Page, frame: Frame) {
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.maintenance", {
      connection: "warehouse",
      schema: "public",
      table: "orders",
    }),
  );
  await expect(frame.locator('[data-part="statement"]')).toHaveText(
    "VACUUM (VERBOSE) public.orders",
  );
}

/** Whether the page itself scrolls, and the panel box's and the Read again button's boxes. */
const layout = (frame: Frame) =>
  frame.evaluate(() => {
    const box = (selector: string) => {
      const r = document.querySelector(selector)?.getBoundingClientRect();
      return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
    };
    const scroller = document.scrollingElement;
    return {
      view: { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
      scrolls: scroller
        ? scroller.scrollHeight > innerHeight + 1 || scroller.scrollWidth > innerWidth + 1
        : false,
      panel: box("#panel-box"),
      refresh: box('#panel-box [data-ctl="refresh"]'),
      wide: [...document.querySelectorAll<HTMLElement>("#panel-box .maint *")].filter(
        (el) => el.getBoundingClientRect().right > innerWidth + 0.5 && !el.closest("pre"),
      ).length,
    };
  });
const within = (a: Box | null, b: Box) =>
  a !== null &&
  a.left >= b.left - 0.5 &&
  a.right <= b.right + 0.5 &&
  a.top >= b.top - 0.5 &&
  a.bottom <= b.bottom + 0.5;

test("the maintenance form says what it locks inside the page at 900×600 and at the first size", async ({
  page,
}) => {
  const frame = await open(page, LARGE);
  await form(page, frame);
  await expect(frame.locator("[data-op]")).toHaveText(["VACUUM", "ANALYZE", "REINDEX", "CLUSTER"]);
  await expect(frame.locator('[data-part="facts"]')).toContainText(
    "16 MB in all (table 12 MB, indexes 4 MB) · 120,000 rows, 30,000 dead",
  );
  const locks = frame.locator('[data-part="locks"]');
  await expect(locks).toHaveAttribute("data-tone", "info");
  await expect(locks).toContainText("SHARE UPDATE EXCLUSIVE");
  await expect(locks).toContainText("outside a transaction block");
  for (const size of [LARGE, FIRST]) {
    await resize(page, size);
    await expect
      .poll(() => frame.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([size.width, size.height]);
    const seen = await layout(frame);
    expect(seen.scrolls, `the page scrolls at ${size.width}`).toBe(false);
    expect(within(seen.panel, seen.view), `the panel inside the page at ${size.width}`).toBe(true);
    expect(within(seen.refresh, seen.view), `Read again in sight at ${size.width}`).toBe(true);
    expect(seen.wide, `nothing wider than the page at ${size.width}`).toBe(0);
  }
  // FULL blocks reads and writes: the words turn into a warning.
  await resize(page, LARGE);
  await frame.locator('[data-key="full"]').check();
  await expect(frame.locator('[data-part="statement"]')).toHaveText(
    "VACUUM (FULL, VERBOSE) public.orders",
  );
  await expect(locks).toHaveAttribute("data-tone", "warning");
  await expect(locks).toContainText("ACCESS EXCLUSIVE");
  await expect(frame.locator('[data-key="parallel"]')).toBeDisabled();
  // REINDEX offers CONCURRENTLY, on by default.
  await frame.locator('[data-op="reindex"]').click();
  await expect(frame.locator('[data-part="statement"]')).toHaveText(
    "REINDEX (VERBOSE) TABLE CONCURRENTLY public.orders",
  );
  await expect(frame.locator('[data-key="concurrently"]')).toBeChecked();
});

test("runs VACUUM from the form and shows the statistics before and after", async ({ page }) => {
  const frame = await open(page, LARGE);
  await form(page, frame);
  await frame.locator('[data-key="analyze"]').check();
  await expect(frame.locator('[data-part="statement"]')).toHaveText(
    "VACUUM (VERBOSE, ANALYZE) public.orders",
  );
  await frame.locator('[data-key="analyze"]').focus();
  await frame.locator('[data-key="analyze"]').press("ControlOrMeta+Enter");
  await expect(frame.locator('[data-part="ended"]')).toHaveText(/^Done in \d/u);
  await expect(frame.locator('[data-part="output"] pre')).toContainText(
    'INFO:  vacuuming "warehouse.public.orders"',
  );
  const row = (label: string) =>
    frame
      .locator('[data-part="stats"] tbody tr')
      .filter({ has: frame.getByRole("rowheader", { name: label, exact: true }) });
  await expect(row("Dead rows")).toHaveAttribute("data-changed", "true");
  await expect(row("Dead rows").locator("td")).toHaveText(["30,000", "0"]);
  await expect(row("Last vacuum").locator("td")).toHaveText(["never", "2026-11-21 10:15:00"]);
  await expect(row("Last analyze").locator("td")).toHaveText(["never", "2026-11-21 10:15:00"]);
  await expect(frame.locator('[data-part="facts"]')).toContainText("120,000 rows, 0 dead");
});
