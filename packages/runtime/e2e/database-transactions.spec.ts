import { expect, type Page, test } from "@playwright/test";

// A PostgreSQL console holds a transaction open in Manual commit (PG-20), on the browser stub: the
// fixture's connection `fixture-pg` (plugins/database/tests/fixtures-pg.ts) has a scripted server
// that fails `select 1/0`. Manual mode begins a transaction at the first run and keeps it for the
// next; the header shows its statements beside Commit and Rollback; Rollback ends it; a failed
// statement leaves only Rollback.
const SURFACE = '[data-surface="endue.database"]';
const LARGE = { width: 1100, height: 600 };

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
    window.__desk.runtime.commands.run("endue.database.console", { connection: "fixture-pg" }),
  );
  return frame;
}

test("a manual console holds a transaction over two runs; the header shows it with Commit and Rollback, and a failed one only Rollback", async ({
  page,
}) => {
  const frame = await open(page);
  const session = frame.locator("#session");
  const mode = frame.locator("#tx-mode");
  const line = frame.locator("#transaction");
  const commit = frame.locator("#tx-commit");
  const rollback = frame.locator("#tx-rollback");
  await expect(mode).toHaveText("Auto commit");
  await expect(commit).toBeHidden();
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await expect(editor).toBeVisible();
  const runs = async (sql: string) => {
    await editor.click();
    await editor.fill(sql);
    await editor.press("ControlOrMeta+Enter");
  };

  await mode.click();
  await expect(mode).toHaveText("Manual commit");
  await expect(mode).toHaveAttribute("aria-pressed", "true");
  await runs("select 1");
  await expect(session).toHaveText("In a transaction");
  await runs("select 2");
  await expect(line).toHaveText(/^2 statements · 0:\d\d$/u);
  await expect(line).toHaveAttribute("title", /Commit \(Mod\+Shift\+Y\)/u);
  await expect(commit).toBeVisible();
  await expect(rollback).toBeVisible();

  await rollback.click();
  await expect(session).toHaveText("Idle");
  await expect(line).toBeHidden();
  await expect(commit).toBeHidden();

  // The next run begins again; a failed statement leaves Rollback alone, which its key ends.
  await runs("select 1/0");
  await expect(session).toHaveText("In a failed transaction");
  await expect(rollback).toBeVisible();
  await expect(commit).toBeHidden();
  await editor.press("ControlOrMeta+Shift+H");
  await expect(session).toHaveText("Idle");

  // Commit by its key.
  await runs("select 3");
  await expect(line).toHaveText(/^1 statement · /u);
  await editor.press("ControlOrMeta+Shift+Y");
  await expect(session).toHaveText("Idle");
  await expect(frame.locator("#status")).toContainText(/Committed: 1 statement/u);

  // A SQLite console has no transaction bar.
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.console", { connection: "fixture" }),
  );
  await expect(frame.locator("#title")).toHaveText("fixture");
  await expect(frame.locator("#transaction-bar")).toBeHidden();
});
