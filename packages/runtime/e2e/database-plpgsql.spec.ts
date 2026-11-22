import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.database's PL/pgSQL bodies (PG-35, ADR 0343) on the browser stub: in a console of the
// fixture's PostgreSQL connection `fixture-pg` (whose schema cache reads the shop of
// plugins/database/tests/pg-catalog.ts), a function's body is drawn as PL/pgSQL inside its dollar
// quotes, a name nothing declares is underlined with its message a pause after typing stops,
// completion after a declared variable's first letters offers it, and BEGIN folds to its END.
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
  await expect(frame.getByRole("treeitem", { level: 3, name: /^public(?:\s|$)/u })).toBeVisible();
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.console", { connection: "fixture-pg" }),
  );
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await expect(editor).toBeVisible();
  await editor.focus();
  return { frame, editor };
}

const setValue = (frame: Frame, text: string) =>
  frame.evaluate((text) => {
    (document.getElementById("editor") as HTMLTextAreaElement).value = text;
  }, text);
const texts = (frame: Frame, cls: string) =>
  frame.locator(`.cm-content .${cls}`).evaluateAll((els) => els.map((e) => e.textContent));

const HEAD = [
  "create function grow(a int) returns int language plpgsql as $$",
  "declare",
  "  total int := 0;",
  "begin",
  "  if a > 0 then",
  "    total := a + y;",
  "  end if;",
  "  return ",
].join("\n");
const TAIL = ";\nend\n$$;";

test("a function's body is drawn, checked, completed and folded as PL/pgSQL", async ({ page }) => {
  const { frame, editor } = await open(page);
  await setValue(frame, `${HEAD}total${TAIL}`);
  await expect
    .poll(() => texts(frame, "tok-variable"))
    .toEqual(["total", "a", "total", "a", "total"]);
  expect(await texts(frame, "tok-keyword")).toEqual(
    expect.arrayContaining(["declare", "begin", "if", "then", "end", "return"]),
  );
  expect(await texts(frame, "tok-string")).toEqual(["$$", "$$"]);

  // The check runs a pause after typing: a name nothing declares is underlined, with its message.
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" ");
  const underlines = frame.locator(".cm-content .cm-lintRange-error");
  await expect(underlines).toHaveText(["y"]);
  await underlines.first().hover();
  await expect(frame.locator(".cm-tooltip-lint")).toContainText('column "y" does not exist');
  await page.screenshot({ path: test.info().outputPath("plpgsql-problem.png") });

  // Completion after a declared variable's first letters.
  await setValue(frame, `${HEAD}${TAIL}`);
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+End");
  for (let i = 0; i < TAIL.length; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("tot", { delay: 30 });
  const option = frame.locator(".cm-tooltip-autocomplete [role=option]").first();
  await expect(option).toContainText("total");
  await page.screenshot({ path: test.info().outputPath("plpgsql-complete.png") });
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      frame.evaluate(() => (document.getElementById("editor") as HTMLTextAreaElement).value),
    )
    .toBe(`${HEAD}total${TAIL}`);

  // BEGIN folds to its END.
  const begin = frame.locator(".cm-line", { hasText: /^begin$/u });
  await begin.click();
  const isMac = await frame.evaluate(() => /Mac/u.test(navigator.platform));
  await page.keyboard.press(isMac ? "Meta+Alt+BracketLeft" : "Control+Shift+BracketLeft");
  await expect(frame.locator(".cm-foldPlaceholder")).toBeVisible();
  await expect(frame.locator(".cm-line", { hasText: "if a > 0" })).toHaveCount(0);
});
