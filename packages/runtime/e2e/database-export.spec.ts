import { expect, type Frame, type Page, test } from "@playwright/test";

// Export a result (PG-61, plugins/database/ui/features/export/) on the browser stub with the scripted
// sqlite3 over the fixture's staff table: Database: export the result to a file picks the format in
// the palette (a stand-in answers CSV), opens the options dialog, and writes the file where the save
// dialog answered (the fixture's ~/Backups) with the options chosen; an .xlsx is written as a zip.
const SURFACE = '[data-surface="endue.database"]';

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

async function open(page: Page, format: string) {
  await page.goto("/database.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate((format) => {
    window.__desk.runtime.commands.define("desk.palette.pick", {
      title: "Pick",
      owner: "desk",
      run: (args) => {
        const title = String((args as { title?: string }).title);
        window.__desk.commands.push(title);
        return title === "Database: export the result as" ? format : "";
      },
    });
  }, format);
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
/** Start a command without waiting for it: it waits for a dialog. */
const start = (page: Page, command: string) =>
  page.evaluate((command) => {
    void window.__desk.runtime.commands.run(command, {}).catch(() => {});
  }, command);
const files = (page: Page) =>
  page.evaluate(() => (window as unknown as { __files: Record<string, string> }).__files);

async function query(page: Page, frame: Frame) {
  await run(page, "endue.database.console", { connection: "fixture" });
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await editor.click();
  await editor.fill("select id, name from staff;");
  await editor.press("ControlOrMeta+Enter");
  await expect(frame.locator("#summary")).toContainText("Done");
}

test("a result is exported as CSV with the options chosen, where the save dialog answered", async ({
  page,
}) => {
  const frame = await open(page, "csv");
  await query(page, frame);
  await start(page, "endue.database.export");
  const form = frame.locator("form.export-options");
  await expect(form).toBeVisible();
  await expect(form.getByRole("heading")).toHaveText("Export as CSV");
  await form.locator('select[name="delimiter"]').selectOption(";");
  await form.locator('select[name="lineEnding"]').selectOption("lf");
  await form.locator('button[type="submit"]').click();
  await expect(form).toBeHidden();
  await expect(frame.locator("#status")).toContainText("Exported 4 rows as CSV to ~/Backups/");
  const all = await files(page);
  const path = Object.keys(all).find((p) => /^~\/Backups\/result-\d{8}-\d{6}\.csv$/u.test(p));
  expect(path).toBeDefined();
  const lines = (all[path as string] ?? "").split("\n");
  expect(lines[0]).toBe("id;name");
  expect(lines).toHaveLength(6);
});

test("an .xlsx is written as a workbook", async ({ page }) => {
  const frame = await open(page, "xlsx");
  await query(page, frame);
  await start(page, "endue.database.export");
  const form = frame.locator("form.export-options");
  await expect(form.getByRole("heading")).toHaveText("Export as Spreadsheet (.xlsx)");
  await form.locator('button[type="submit"]').click();
  await expect(frame.locator("#status")).toContainText("Exported 4 rows as Spreadsheet (.xlsx)");
  const all = await files(page);
  const path = Object.keys(all).find((p) => p.endsWith(".xlsx"));
  // fs.write keeps base64 as it came: a zip starts with PK.
  expect(atob(all[path as string] ?? "").slice(0, 2)).toBe("PK");
});
