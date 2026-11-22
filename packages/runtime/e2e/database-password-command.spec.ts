import { expect, type Frame, type Page, test } from "@playwright/test";

// A PostgreSQL connection's password command and its "through a pooler" choice (PG-14) on the
// browser stub: the form shows both for PostgreSQL only, says what is wrong with a command or with
// session options beside the pooler, and keeps both on the fixture's `fixture-pg`, which the form
// shows again when it opens; a console on the marked connection refuses SET in words.
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

test("the form shows the password command and the pooler choice for PostgreSQL only", async ({
  page,
}) => {
  const frame = await open(page);
  await frame.locator('[data-act="create"]').dispatchEvent("click");
  const field = frame.locator("#f-passwordCommand");
  const pooler = frame.locator("#f-pooler");
  await expect(field).toBeVisible();
  await expect(pooler).toBeVisible();
  for (const engine of ["sqlite", "mysql"]) {
    await frame.locator("#f-engine").selectOption(engine);
    await expect(field).toBeHidden();
    await expect(pooler).toBeHidden();
  }
  await frame.locator("#f-engine").selectOption("postgresql");
  await expect(field).toBeVisible();
  await frame.locator("#form-cancel").dispatchEvent("click");
});

test("a command and the pooler choice are checked, kept and shown again", async ({ page }) => {
  const frame = await open(page);
  await command(page, "endue.database.edit-connection", { connection: "fixture-pg" });
  const form = frame.locator("#form");
  await expect(form).toBeVisible();
  const save = frame.locator('#form [type="submit"]');
  const error = frame.locator("#form-error");

  await frame.locator("#f-passwordCommand").fill("bin/db-token --user app");
  await save.dispatchEvent("click");
  await expect(error).toContainText("Password command: the program by its name, or its full path");

  await frame.locator("#f-passwordCommand").fill('/opt/tokens/db-token  --label "shop db"');
  await frame.locator("#f-pooler").check();
  await frame.locator("#f-options > summary").dispatchEvent("click");
  await frame.locator("#f-searchPath").fill("app, public");
  await save.dispatchEvent("click");
  await expect(error).toContainText("Search path: a connection through a pooler keeps no session");
  await frame.locator("#f-searchPath").fill("");
  await save.dispatchEvent("click");
  await expect(form).toBeHidden();

  await command(page, "endue.database.edit-connection", { connection: "fixture-pg" });
  await expect(form).toBeVisible();
  await expect(frame.locator("#f-passwordCommand")).toHaveValue(
    '/opt/tokens/db-token --label "shop db"',
  );
  await expect(frame.locator("#f-pooler")).toBeChecked();
  // The command gives the password, so it is not asked at the console's first run: take it out to
  // run on the fixture's server, and keep the pooler choice.
  await frame.locator("#f-passwordCommand").fill("");
  await save.dispatchEvent("click");
  await expect(form).toBeHidden();

  await command(page, "endue.database.console", { connection: "fixture-pg" });
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await editor.click();
  await editor.fill("set work_mem = '64MB'");
  await editor.press("ControlOrMeta+Enter");
  await expect(frame.locator("#status")).toContainText(
    "fixture-pg goes through a pooler: statement 1 (SET)",
  );
});
