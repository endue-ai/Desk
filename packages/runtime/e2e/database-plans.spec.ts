import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.database's query plans (PG-70, ADR 0289) on the browser stub: the saved PostgreSQL
// connection "warehouse" whose psql is scripted (plugins/database/tests/fixture-plans.ts) answers
// EXPLAIN with a plan of a join, another after `create index`. The plan's tree, its flame and
// table, two plans compared side by side and the options dialog, in a 900×600 window's page.
const SURFACE = '[data-surface="endue.database"]';
const LARGE = { width: 898, height: 558 };
type Box = { left: number; top: number; right: number; bottom: number };
const QUERY =
  "select o.id, c.name from orders o join customers c on c.id = o.customer_id where c.region = 'north' order by o.total";

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

/** Open the fixture page and endue.database at 898×558, and resolve with its frame. */
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
  await expect(frame.locator("#tree [role=treeitem]", { hasText: "warehouse" })).toBeVisible();
  await expect
    .poll(() => frame.evaluate(() => [innerWidth, innerHeight]))
    .toEqual([LARGE.width, LARGE.height]);
  return frame;
}

/** Run a desk command; `wait: false` leaves it running (a dialog it shows waits for an answer). */
const run = (page: Page, command: string, args: Record<string, unknown> = {}, wait = true) =>
  page.evaluate(
    ([command, args, wait]) => {
      const done = window.__desk.runtime.commands.run(command, args);
      if (wait) return done.then(() => undefined);
      // Left running: a cancelled dialog ends it, which is no failure here.
      done.catch(() => {});
      return undefined;
    },
    [command, args, wait] as const,
  );

/** The console's SQL editor, by its role and name (the textarea or the editor that stands for it). */
const sql = (frame: Frame) => frame.getByRole("textbox", { name: "SQL" });

/** A console on "warehouse" with the query in its editor. */
async function openConsole(page: Page, frame: Frame, text = QUERY) {
  await run(page, "endue.database.console", { connection: "warehouse" });
  await sql(frame).fill(text);
}

/** A box inside another, to half a pixel. */
const within = (a: Box, b: Box) =>
  a.left >= b.left - 0.5 &&
  a.right <= b.right + 0.5 &&
  a.top >= b.top - 0.5 &&
  a.bottom <= b.bottom + 0.5;
const box = (frame: Frame, selector: string, index = 0) =>
  frame.evaluate(
    ([selector, index]) => {
      const r = document.querySelectorAll(selector)[index]?.getBoundingClientRect();
      return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
    },
    [selector, index] as const,
  );

test("a plan shows estimate against actual rows, its marks, and its flame of own time", async ({
  page,
}) => {
  const frame = await open(page);
  await openConsole(page, frame);
  await run(page, "endue.database.explain-analyze");
  const plan = frame.locator(".plan-box");
  await expect(plan).toBeVisible();
  await expect(plan.locator(".plan-summary")).toContainText("33.4 ms");
  const sort = plan.locator("[role=treeitem]").first();
  await expect(sort.locator(".plan-facts").first()).toContainText("est. 100 → 6,000 rows");
  await expect(sort.locator(".plan-mark").first()).toHaveText("60× more rows than estimated");
  await expect(plan.locator(".plan-mark", { hasText: "the sort spilled to disk" })).toBeVisible();
  await expect(
    plan.locator(".plan-mark", { hasText: "filters 99% of the 2,000 rows it reads away" }),
  ).toBeVisible();

  await plan.locator('.plan-views [data-view="flame"]').click();
  const blocks = frame.locator(".flame-block");
  await expect(blocks).toHaveCount(5);
  await expect(frame.locator(".plan-views [aria-selected=true]")).toHaveText("Flame");
  const flame = await box(frame, ".flame-row");
  const root = await box(frame, ".flame-block");
  expect(
    flame && root && Math.abs(root.right - root.left - (flame.right - flame.left)),
  ).toBeLessThan(2);
  for (let i = 0; i < 5; i++) {
    const b = await box(frame, ".flame-block", i);
    expect(
      b && flame && b.left >= flame.left - 0.5 && b.right <= flame.right + 0.5,
      `block ${i}`,
    ).toBe(true);
  }
  await expect(blocks.first()).toHaveAttribute("aria-label", /^Sort: 5\.5 ms own of 32\.9 ms/u);
  // A block is as wide as its node's time: the scan of orders takes most of the join's.
  const widths = await frame.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".flame-block")].map((b) => [
      b.getAttribute("aria-label") ?? "",
      b.getBoundingClientRect().width,
    ]),
  );
  expect(
    widths.find(([label]) => String(label).startsWith("Seq Scan on orders"))?.[1],
  ).toBeGreaterThan(Number(widths.find(([label]) => String(label).startsWith("Hash:"))?.[1]));
  const scrolls = await frame.evaluate(() => {
    const el = document.scrollingElement;
    return el ? el.scrollHeight > innerHeight + 1 || el.scrollWidth > innerWidth + 1 : false;
  });
  expect(scrolls, "the page itself scrolls").toBe(false);

  await plan.locator('.plan-views [data-view="table"]').click();
  await expect(frame.locator(".plan-table tbody tr")).toHaveCount(5);
  await expect(frame.locator(".plan-table tbody th").first()).toHaveText("Seq Scan on orders o");
});

test("two plans of the statement, before and after an index, compared side by side", async ({
  page,
}) => {
  const frame = await open(page);
  await openConsole(page, frame);
  await run(page, "endue.database.explain-analyze");
  await expect(frame.locator(".plan-box")).toBeVisible();
  await sql(frame).fill("create index orders_customer_idx on orders (customer_id)");
  await run(page, "endue.database.run");
  await expect(frame.locator("#summary")).toContainText("Done");
  await sql(frame).fill(QUERY);
  await run(page, "endue.database.explain-analyze");
  await expect(frame.locator(".plan-box [role=treeitem]").nth(1)).toContainText("Nested Loop");

  await run(page, "endue.database.compare-plans");
  const panel = frame.locator(".plans");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".plans-side h3").first()).toContainText("Before: Plan (analyzed)");
  await expect(panel.locator(".plans-sql").first()).toHaveText(QUERY);
  const rows = panel.locator(".plans-table tbody tr");
  await expect(rows.first().locator(".plans-change")).toContainText("time 32.9 ms → 4.1 ms (−88%)");
  await expect(
    panel.locator(".plans-change", { hasText: "Hash Join → Nested Loop" }),
  ).toBeVisible();
  await expect(panel.locator(".plans-change", { hasText: "Seq Scan → Index Scan" })).toBeVisible();
  await expect(panel.locator(".plans-count")).toHaveText(/^\d of 5 nodes changed$/u);
  // Both sides in sight, a long statement cut short rather than pushing the other side out.
  const view = { left: 0, top: 0, right: LARGE.width, bottom: LARGE.height };
  for (const i of [0, 1]) {
    const side = await box(frame, ".plans-side", i);
    expect(side && within(side, view), `side ${i} in sight`).toBe(true);
  }
});

test("the options dialog says what ANALYZE does and remembers the options", async ({ page }) => {
  const frame = await open(page);
  await openConsole(page, frame);
  await run(page, "endue.database.explain-options", {}, false);
  const dialog = frame.locator("form.plan-options");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#plan-options-safety")).toContainText(
    "A write runs inside a transaction that is rolled back",
  );
  await expect(dialog.locator('input[name="WAL"]')).toBeDisabled();
  await dialog.locator('input[name="ANALYZE"]').check();
  await expect(dialog.locator('input[name="WAL"]')).toBeEnabled();
  await dialog.locator('input[name="VERBOSE"]').check();
  const form = await box(frame, "form.plan-options");
  expect(form && within(form, { left: 0, top: 0, right: LARGE.width, bottom: LARGE.height })).toBe(
    true,
  );
  // Enter on the button: the desk's window clips the page's bottom edge from the pointer here.
  await dialog.locator('button[type="submit"]').press("Enter");
  await expect(dialog).toBeHidden();
  await expect(frame.locator(".plan-box")).toBeVisible();

  await run(page, "endue.database.explain-options", {}, false);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[name="VERBOSE"]')).toBeChecked();
  await expect(dialog.locator('input[name="ANALYZE"]')).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
