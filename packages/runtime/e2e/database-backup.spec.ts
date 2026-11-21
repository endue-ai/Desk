import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.database's backup and restore (PG-62, ADR 0313) on the browser stub: the scripted
// PostgreSQL connection `warehouse` (plugins/database/tests/activity-fixture.ts) and the scripted
// pg_dump and pg_restore (backup-fixture.ts). The backup form with its exact command line, then
// pg_dump's lines and what it wrote in the log panel; the restore form with the archive's entries,
// filtered and chosen, then pg_restore's. Both forms stay inside the page at two sizes.
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
  await expect(frame.locator("#tree [role=treeitem]", { hasText: "warehouse" })).toBeVisible();
  await expect
    .poll(() => frame.evaluate(() => [innerWidth, innerHeight]))
    .toEqual([size.width, size.height]);
  return frame;
}

/** Run a desk command and leave it running: the form it shows waits for the person. The forms are
 * worked by keys: the page's window stays at its first size while its frame is made larger, so a
 * pointer would land on the window around it. */
const start = (page: Page, command: string, args: Record<string, unknown>) =>
  page.evaluate(
    ([command, args]) => {
      window.__desk.runtime.commands.run(command, args).catch(() => {});
    },
    [command, args] as const,
  );

/** Whether the page itself scrolls, and the box of `selector`. */
const layout = (frame: Frame, selector: string) =>
  frame.evaluate((selector) => {
    const r = document.querySelector(selector)?.getBoundingClientRect();
    const scroller = document.scrollingElement;
    return {
      view: { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
      scrolls: scroller
        ? scroller.scrollHeight > innerHeight + 1 || scroller.scrollWidth > innerWidth + 1
        : false,
      box: r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null,
    };
  }, selector);
const within = (a: Box | null, b: Box) =>
  a !== null &&
  a.left >= b.left - 0.5 &&
  a.right <= b.right + 0.5 &&
  a.top >= b.top - 0.5 &&
  a.bottom <= b.bottom + 0.5;

/** The form stays inside the page at both sizes, and the page itself never scrolls. */
async function fits(page: Page, frame: Frame, selector: string) {
  for (const size of [FIRST, LARGE]) {
    await resize(page, size);
    await expect
      .poll(() => frame.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([size.width, size.height]);
    const seen = await layout(frame, selector);
    expect(seen.scrolls, `the page scrolls at ${size.width}`).toBe(false);
    expect(within(seen.box, seen.view), `${selector} inside the page at ${size.width}`).toBe(true);
  }
}

test("the backup form shows the exact command line, then pg_dump's lines and what it wrote", async ({
  page,
}) => {
  const frame = await open(page, LARGE);
  await start(page, "endue.database.backup", { connection: "warehouse" });
  const form = frame.locator("form.backup-form");
  await expect(form).toBeVisible();
  await expect(form.locator("h2")).toHaveText("Back up warehouse");
  const command = form.locator('[data-part="command"]');
  await expect(command).toContainText(
    "pg_dump --format=custom --verbose --no-password --file=(chosen next)",
  );
  await expect(command).not.toContainText("PGPASSWORD");
  await fits(page, frame, "form.backup-form");

  await form.locator('select[name="format"]').selectOption("directory");
  await expect(form.locator('[data-part="jobs"]')).toBeVisible();
  await form.locator('input[name="jobs"]').fill("4");
  await form.locator('select[name="format"]').selectOption("custom");
  await form.locator('input[name="scope"][value="tables"]').press("Space");
  await form.locator('input[name="tables"]').fill("public.orders");
  await form.locator('input[name="noOwner"]').press("Space");
  await expect(command).toContainText(
    "--format=custom --verbose --no-password --table=public.orders --strict-names --no-owner",
  );
  await form.locator('button[type="submit"]').press("Enter");
  await expect(form).toBeHidden();

  const log = frame.locator(".backup-log");
  await expect(log.locator('[data-part="result"]')).toHaveText(
    /^Wrote the file ~\/Backups\/warehouse-\d{4}-\d\d-\d\d-\d{4}\.dump \(19 KiB\) in \d+\.\d s, with 1 table's rows\.$/u,
  );
  await expect(log.locator(".backup-status")).toHaveText("Done · 1 table");
  await expect(log.locator('[data-part="log"]')).toContainText(
    'pg_dump: dumping contents of table "public.orders"',
  );
  await expect(log.locator('[data-part="command"]')).toContainText("PGDATABASE=warehouse");
  await expect(log.locator('[data-ctl="cancel"]')).toBeHidden();
  await fits(page, frame, ".backup-log");
});

test("the restore form lists the archive's entries, restores the chosen ones and says how far it got", async ({
  page,
}) => {
  const frame = await open(page, LARGE);
  await start(page, "endue.database.restore", { path: "~/Backups/warehouse.dump" });
  const form = frame.locator("form.restore-form");
  await expect(form).toBeVisible();
  await expect(form.locator("h2")).toHaveText("Restore warehouse.dump");
  await expect(form.locator('[data-part="count"]')).toHaveText("9 of 9 entries");
  await fits(page, frame, "form.restore-form");

  await form.locator('select[name="connection"]').selectOption("c-warehouse");
  await form.locator('input[name="clean"]').press("Space");
  await form.locator('input[name="ifExists"]').press("Space");
  await form.locator('input[name="filter"]').fill("orders");
  await expect(form.locator(".restore-entry")).toHaveCount(4);
  await form.locator('[data-ctl="none"]').press("Enter");
  await expect(form.locator('[data-part="count"]')).toHaveText("5 of 9 entries");
  await expect(form.locator('[data-part="command"]')).toContainText(
    "--dbname=warehouse --clean --if-exists --use-list=./.endue/database/restore/c-warehouse.list ./Backups/warehouse.dump",
  );
  await form.locator('button[type="submit"]').press("Enter");
  await expect(form).toBeHidden();

  const log = frame.locator(".backup-log");
  await expect(log.locator('[data-part="result"]')).toHaveText(
    /^Restored warehouse\.dump into warehouse in \d+\.\d s: 5 entries\.$/u,
  );
  await expect(log.locator(".backup-status")).toHaveText("Done · 5 of 5 entries");
  const written = await page.evaluate(
    () =>
      (window as unknown as { __files: Record<string, string> }).__files[
        "~/.endue/database/restore/c-warehouse.list"
      ],
  );
  expect(written?.split("\n")[0]).toBe("; Chosen in endue Desk: 5 of 9 entries");
});
