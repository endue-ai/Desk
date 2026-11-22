import { expect, type Frame, type Page, test } from "@playwright/test";

// A PostgreSQL connection's session options (PG-12) on the browser stub: the connection form shows
// them for PostgreSQL only; saved on the fixture's `fixture-pg` (plugins/database/tests/fixtures-pg.ts),
// the console's header says the role and the search path, and `SHOW search_path` answers what the
// session signed in with (session-options-fixture.ts answers it from the session's settings).
const SURFACE = '[data-surface="endue.database"]';
const LARGE = { width: 898, height: 558 };

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

async function open(page: Page): Promise<Frame> {
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

test("the form shows the session options for PostgreSQL only", async ({ page }) => {
  const frame = await open(page);
  // The iframe is sized past its window: a pointer below the window's box would land on the desk.
  await frame.locator('[data-act="create"]').dispatchEvent("click");
  const options = frame.locator("#f-options");
  await expect(options).toBeVisible();
  await frame.locator("#f-engine").selectOption("sqlite");
  await expect(options).toBeHidden();
  await frame.locator("#f-engine").selectOption("mysql");
  await expect(options).toBeHidden();
  await frame.locator("#f-engine").selectOption("postgresql");
  await expect(options).toBeVisible();
  await frame.locator("#form-cancel").dispatchEvent("click");
});

test("saved options reach the session, and the header shows the role and the search path", async ({
  page,
}) => {
  const frame = await open(page);
  await command(page, "endue.database.edit-connection", { connection: "fixture-pg" });
  await expect(frame.locator("#form")).toBeVisible();
  await frame.locator("#f-options > summary").dispatchEvent("click");
  await frame.locator("#f-searchPath").fill("app, public");
  await frame.locator("#f-role").fill("reporting");
  await frame.locator("#f-timeZone").fill("Asia/Seoul");
  await frame.locator("#f-lockTimeout").fill("5s");
  await frame.locator('#form [type="submit"]').dispatchEvent("click");
  await expect(frame.locator("#form")).toBeHidden();

  await command(page, "endue.database.console", { connection: "fixture-pg" });
  const shown = frame.locator("#session-options");
  await expect(shown).toBeVisible();
  await expect(shown).toHaveText("as reporting · app, public");

  const editor = frame.getByRole("textbox", { name: "SQL" });
  const value = async (sql: string) => {
    await editor.click();
    await editor.fill(sql);
    await editor.press("ControlOrMeta+Enter");
    return frame.locator("#result [role=gridcell]").first();
  };
  await expect(await value("show search_path")).toHaveText("app, public");
  await expect(await value("show timezone")).toHaveText("Asia/Seoul");
  await expect(await value("select current_user")).toHaveText("reporting");

  // A connection that sets neither shows nothing there.
  await command(page, "endue.database.console", { connection: "fixture" });
  await expect(shown).toBeHidden();
});
