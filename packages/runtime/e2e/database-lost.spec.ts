import { expect, type Page, test } from "@playwright/test";

// A lost connection loses no work (PG-105, ADR 0355), on the browser stub: the fixture's connection
// `fixture-pg` (plugins/database/tests/fixtures-pg.ts). A manual console holds a transaction of two
// statements; a second console ends its session with pg_terminate_backend, as the server would. The
// first console's header says Session lost and offers Reconnect, the status line names the two
// statements rolled back and not run again, the console's text stays, and Reconnect brings it back.
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
  return frame;
}

const command = (page: Page, id: string, args: Record<string, unknown>) =>
  page.evaluate(([id, args]) => window.__desk.runtime.commands.run(id, args), [id, args] as const);

test("a manual console's transaction ended by the server is said with its statements, its text stays, and Reconnect brings the session back", async ({
  page,
}) => {
  const frame = await open(page);
  const first = await command(page, "endue.database.console", { connection: "fixture-pg" });
  const session = frame.locator("#session");
  const reconnect = frame.locator("#session-reconnect");
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await expect(editor).toBeVisible();
  const runs = async (sql: string) => {
    await editor.click();
    await editor.fill(sql);
    await editor.press("ControlOrMeta+Enter");
  };

  await frame.locator("#tx-mode").click();
  await runs("select 1");
  await runs("select 2");
  await expect(session).toHaveText("In a transaction");
  await expect(reconnect).toBeHidden();
  const pid = /Session (\d+)/u.exec((await session.getAttribute("title")) ?? "")?.[1];
  expect(Number(pid)).toBeGreaterThan(0);

  // A second console ends the first one's session.
  await command(page, "endue.database.new-console", { connection: "fixture-pg" });
  await runs(`select pg_terminate_backend(${pid})`);
  await expect(frame.locator("#status")).toContainText(
    /rolled back its open transaction with its 2 statements; none was run again/u,
  );

  await command(page, "endue.database.consoles", { console: first });
  await expect(session).toHaveText("Session lost");
  await expect(session).toHaveAttribute("title", /select 1.*select 2/su);
  await expect(editor).toHaveText("select 2");
  await expect(reconnect).toBeVisible();
  await reconnect.click();
  await expect(session).toHaveText("Idle");
  await expect(reconnect).toBeHidden();
  await expect(frame.locator("#status")).toContainText(/connected on a new session/u);
});
