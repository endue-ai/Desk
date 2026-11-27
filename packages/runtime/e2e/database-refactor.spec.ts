import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.database's refactorings (PG-33) on the browser stub: the fixture's PostgreSQL connection
// `fixture-pg` has a scripted server whose catalog the schema cache reads (the shop of
// plugins/database/tests/pg-catalog.ts) and which answers a rename's reads
// (plugins/database/tests/refactor-fixture.ts). F2 on a CTE's use renames it everywhere with the
// palette's answer (a desk command stands in for the palette); renaming a column opens its script
// in a console of its own, which holds the rewritten body and the ALTER and has not run.
const SURFACE = '[data-surface="endue.database"]';
const TEXT = "with t as (select id from people) select t.id from t where t.id > 0";

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

async function open(page: Page) {
  await page.goto("/database.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() => {
    window.__desk.runtime.commands.define("desk.palette.pick", {
      title: "Pick",
      owner: "desk",
      run: (args) => {
        const title = String((args as { title?: string }).title);
        window.__desk.commands.push(title);
        return title.startsWith("Database: rename") ? "picked" : "";
      },
    });
  });
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
  const row = frame.locator("#tree [role=treeitem]", { hasText: "fixture-pg" });
  await expect(row).toBeVisible();
  // The explorer opens the connection's schema cache; the refactorings read only what it holds.
  await row.click();
  await page.keyboard.press("ArrowRight");
  const schema = frame.locator("#tree [role=treeitem]", {
    has: frame.locator(".label", { hasText: /^public$/u }),
  });
  await expect(schema.first()).toBeVisible();
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.console", { connection: "fixture-pg" }),
  );
  await expect(frame.getByRole("textbox", { name: "SQL" })).toBeVisible();
  return frame;
}

/** The console's text set and the caret put at `at`, focused. */
async function caretAt(frame: Frame, text: string, at: number) {
  await frame.evaluate(
    ([value, caret]) => {
      const area = document.getElementById("editor") as HTMLTextAreaElement;
      if (area.value !== value) area.value = value as string;
      area.focus();
      area.setSelectionRange(caret as number, caret as number);
    },
    [text, at],
  );
}

const editorText = (frame: Frame) =>
  frame.evaluate(() => (document.getElementById("editor") as HTMLTextAreaElement).value);

test("F2 on a CTE renames it and every use with the palette's answer", async ({ page }) => {
  const frame = await open(page);
  await caretAt(frame, TEXT, TEXT.indexOf(" t where") + 1);
  await page.keyboard.press("F2");
  await expect
    .poll(() => editorText(frame))
    .toBe(
      "with picked as (select id from people) select picked.id from picked where picked.id > 0",
    );
  expect(await page.evaluate(() => window.__desk.commands)).toContain("Database: rename t to?");
  await expect(frame.locator("#status")).toContainText("Renamed t to picked in 4 places.");
});

test("renaming a column opens its script in a console of its own, not run", async ({ page }) => {
  const frame = await open(page);
  const text = "select name from people";
  await caretAt(frame, text, 9);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.rename-at-caret", { to: "full_name" }),
  );
  await expect
    .poll(() => editorText(frame))
    .toContain("ALTER TABLE public.people RENAME COLUMN name TO full_name;");
  const script = await editorText(frame);
  expect(script).toContain("UPDATE people SET full_name = upper(full_name);");
  expect(script).toContain("-- Follow the rename by themselves (1)");
  await expect(frame.locator("#status")).toContainText("not run");
  await page.screenshot({ path: test.info().outputPath("refactor-script.png") });
});
