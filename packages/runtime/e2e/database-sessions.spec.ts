import { expect, type Page, test } from "@playwright/test";

// A PostgreSQL console keeps its session between runs (PG-02, ADR 0320) on the browser stub: the
// fixture's connection `fixture-pg` (plugins/database/tests/fixtures-pg.ts) has a scripted server
// that fails `select 1/0`. The header says the session's state after each run: idle, in a
// transaction, in a failed transaction (which says ROLLBACK is needed), idle again after ROLLBACK.
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
    window.__desk.runtime.commands.run("endue.database.console", { connection: "fixture-pg" }),
  );
  return frame;
}

test("a PostgreSQL console's header shows its session: idle, in a transaction, in a failed transaction, idle after ROLLBACK", async ({
  page,
}) => {
  const frame = await open(page);
  const session = frame.locator("#session");
  await expect(session).toBeVisible();
  await expect(session).toHaveText("Not connected");
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await expect(editor).toBeVisible();
  const runs = async (sql: string) => {
    await editor.click();
    await editor.fill(sql);
    await editor.press("ControlOrMeta+Enter");
  };

  await runs("select 1");
  await expect(session).toHaveText("Idle");
  await runs("begin");
  await expect(session).toHaveText("In a transaction");
  await expect(session.locator(".desk-dot")).toHaveAttribute("data-tone", "warning");
  await runs("select 1/0");
  await expect(session).toHaveText("In a failed transaction");
  await expect(session).toHaveAttribute("title", /ROLLBACK/u);
  await expect(session.locator(".desk-dot")).toHaveAttribute("data-tone", "danger");
  await runs("rollback");
  await expect(session).toHaveText("Idle");

  // A SQLite console has no session to show.
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.console", { connection: "fixture" }),
  );
  await expect(frame.locator("#title")).toHaveText("fixture");
  await expect(session).toBeHidden();
});
