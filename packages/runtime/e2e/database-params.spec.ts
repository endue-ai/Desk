import { expect, type Page, test } from "@playwright/test";

// Bound parameters and the check without running in endue.database (PG-21, ADR 0353), on the
// fixture's scripted PostgreSQL connection `fixture-pg` (params-fixture.ts): the prompt for each
// parameter names the type the server inferred (a desk command stands in for the palette and
// answers), the run comes back with its rows, and Database: check the statement without running it
// shows what the statement takes and answers in the console's grid and says so.
const SURFACE = '[data-surface="endue.database"]';

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

const ANSWERS: Record<string, string> = {
  "Value for :person (text)": "ada",
  "Value for :least (numeric)": "10",
};

async function open(page: Page) {
  await page.goto("/database.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate((answers) => {
    window.__desk.runtime.commands.define("desk.palette.pick", {
      title: "Pick",
      owner: "desk",
      run: (args) => {
        const title = String((args as { title?: string }).title);
        window.__desk.commands.push(title);
        return answers[title] ?? "";
      },
    });
  }, ANSWERS);
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

const run = (page: Page, command: string) =>
  page.evaluate((command) => window.__desk.runtime.commands.run(command, {}), command);

const SQL = "select id, person, total from orders where person = :person and total > :least";

test("a PostgreSQL console asks each parameter with its type, runs with bound values, and checks without running", async ({
  page,
}) => {
  const frame = await open(page);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.console", { connection: "fixture-pg" }),
  );
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await expect(editor).toBeVisible();
  await frame.evaluate((sql) => {
    const area = document.getElementById("editor") as HTMLTextAreaElement;
    area.value = sql;
    area.setSelectionRange(sql.length, sql.length);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }, SQL);

  await run(page, "endue.database.run");
  await expect
    .poll(() =>
      page.evaluate(() => window.__desk.commands.filter((t) => t.startsWith("Value for"))),
    )
    .toEqual(["Value for :person (text)", "Value for :least (numeric)"]);
  const cells = frame.locator("#result [role=gridcell]");
  await expect(cells.filter({ hasText: "40.00" })).toHaveCount(1);

  expect(await run(page, "endue.database.check")).toBe(
    "Checked, nothing ran: takes :person text, :least numeric; answers 3 columns.",
  );
  await expect(cells.filter({ hasText: "parameter" })).toHaveCount(2);
  await expect(cells.filter({ hasText: /^numeric$/u })).toHaveCount(2);
});
