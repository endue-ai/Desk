import { expect, type Frame, type Page, test } from "@playwright/test";

// Format SQL in endue.database (ADR 0291) on the fixture's scripted PostgreSQL connection
// `warehouse`: a messy script in a console laid out again from PostgreSQL's own parse tree in the
// parse worker, by Mod+Shift+F and by the palette's commands (the whole console, the statement at
// the caret), comments kept, and a statement that does not parse left as written and said.
const SURFACE = '[data-surface="endue.database"]';

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
  await iframe.evaluate((el) => {
    el.style.cssText += ";width:898px!important;height:558px!important";
  });
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").first()).toContainText("fixture");
  return frame;
}

const run = (page: Page, command: string) =>
  page.evaluate((command) => window.__desk.runtime.commands.run(command, {}), command);

/** The editor's text and caret, through the console's textarea handle. */
const value = (frame: Frame) =>
  frame.evaluate(() => (document.getElementById("editor") as HTMLTextAreaElement).value);
const setValue = (frame: Frame, text: string, caret = 0) =>
  frame.evaluate(
    ([text, caret]) => {
      const editor = document.getElementById("editor") as HTMLTextAreaElement;
      editor.value = text;
      editor.setSelectionRange(caret, caret);
    },
    [text, caret] as const,
  );

const MESSY = [
  "-- the people who spent the most",
  "select p.id,p.name , sum(o.total) as spent from people p join orders o on o.person=p.id",
  "where o.total>0 and p.note is not null group by p.id,p.name order by spent desc limit 5;",
  "select   1",
].join("\n");

const LAID = [
  "-- the people who spent the most",
  "SELECT p.id, p.name, sum(o.total) AS spent",
  "FROM people p",
  "JOIN orders o ON o.person = p.id",
  "WHERE o.total > 0 AND p.note IS NOT NULL",
  "GROUP BY p.id, p.name",
  "ORDER BY spent DESC",
  "LIMIT 5;",
  "",
  "SELECT 1",
].join("\n");

test("Format SQL lays a messy PostgreSQL console out again, the whole console or the statement at the caret", async ({
  page,
}) => {
  const frame = await open(page);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.console", { connection: "warehouse" }),
  );
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await expect(editor).toBeVisible();
  await setValue(frame, MESSY);
  await editor.focus();
  // Mod+Shift+F formats the whole console, in the parse worker, and says so.
  await page.keyboard.press("ControlOrMeta+Shift+F");
  await expect.poll(() => value(frame)).toBe(LAID);
  await expect(frame.locator("#status")).toHaveText("Formatted.");
  // A second Format changes nothing.
  await run(page, "endue.database.format");
  await expect(frame.locator("#status")).toHaveText("Formatted.");
  expect(await value(frame)).toBe(LAID);
  // The statement at the caret, and nothing around it.
  await setValue(frame, "select 1;\nselect a,b from t where x=1;\nselect   3", 15);
  await run(page, "endue.database.format-statement");
  await expect
    .poll(() => value(frame))
    .toBe("select 1;\nSELECT a, b\nFROM t\nWHERE x = 1;\nselect   3");
  // A statement that does not parse is left as written, and the status line says where.
  await setValue(frame, "select   1;\nselec oops");
  await run(page, "endue.database.format");
  await expect(frame.locator("#status")).toHaveText(
    'Formatted; a statement that does not parse is left as written (line 2: syntax error at or near "selec").',
  );
  expect(await value(frame)).toBe("SELECT 1;\nselec oops");
});
