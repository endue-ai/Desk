import { expect, type Page, test } from "@playwright/test";

// endue.database's SQL warnings (PG-36, ADR 0328) on the browser stub: on the fixture's PostgreSQL
// connection `fixture-pg` (the shop of plugins/database/tests/pg-catalog.ts, read by the schema
// cache), a statement that is likely a mistake is underlined as a warning while typing, its hover
// names its identifier and offers the fix, and the fix rewrites the text; the palette's command
// fixes the warning at the caret.
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
  const row = frame.locator("#tree [role=treeitem]", { hasText: "fixture-pg" });
  await expect(row).toBeVisible();
  await row.click();
  await page.keyboard.press("ArrowRight");
  // The schema row by its own label: while the cache reads, "publications" is in other rows too.
  const schema = frame.locator("#tree [role=treeitem]", {
    has: frame.locator(".label", { hasText: /^public$/u }),
  });
  await expect(schema.first()).toBeVisible();
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.console", { connection: "fixture-pg" }),
  );
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await expect(editor).toBeVisible();
  await editor.focus();
  return { frame, editor };
}

test("a likely mistake is underlined as a warning, named on hover, and its fix rewrites the statement", async ({
  page,
}) => {
  const { frame, editor } = await open(page);
  const text = frame.locator(".cm-content");
  const warnings = frame.locator(".cm-content .cm-lintRange-warning");
  await editor.pressSequentially("select * from people where name = null", { delay: 20 });
  await expect(warnings).toHaveText(["= null"]);
  await page.keyboard.press("Escape");
  await expect(frame.locator(".cm-content .cm-lintRange-error")).toHaveCount(0);
  await expect(frame.locator(".cm-gutter-lint .cm-lint-marker-warning")).toHaveCount(1);

  await warnings.first().hover();
  const tooltip = frame.locator(".cm-tooltip-lint");
  await expect(tooltip).toContainText(
    "= NULL is never true, not even when the value is NULL: IS NULL tests for it.",
  );
  await expect(tooltip).toContainText("warning null-comparison");
  const action = tooltip.getByRole("button", { name: "Use IS NULL" });
  await expect(action).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("warnings-hover.png") });
  // The fixture's window shows the frame's left part only, and the button sits past it: press it
  // as the person's click would reach it.
  await action.dispatchEvent("click");
  await expect(text).toHaveText("select * from people where name is null");
  await expect(warnings).toHaveCount(0);

  // The palette's command fixes the warning at the caret: the INSERT gets its column list.
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(";\ninsert into people values (1, 'a')");
  await expect(warnings).toHaveText(["people"]);
  for (let i = 0; i < " values (1, 'a')".length + 2; i++) await page.keyboard.press("ArrowLeft");
  await page.evaluate(() => window.__desk.runtime.commands.run("endue.database.fix-problem", {}));
  await expect(text).toContainText("insert into people (id, name) values (1, 'a')");
  await expect(frame.locator("#status")).toContainText("Fixed: List the columns.");
  await expect(warnings).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("warnings-fixed.png") });
});
