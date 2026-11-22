import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.database's navigation from a name (PG-32) on the browser stub: the fixture's PostgreSQL
// connection `fixture-pg` has a scripted server whose catalog the schema cache reads (the shop of
// plugins/database/tests/pg-catalog.ts). F12 on a CTE's use selects where it is defined, F12 on a
// table opens its DDL, resting the pointer on a table shows its card, Alt+F12 shows a column's card
// at the caret, and Shift+F12 lists the console's places in the usages panel, one of which brings
// the caret back to it.
const SURFACE = '[data-surface="endue.database"]';
const TEXT = "with t as (select 1 as x) select * from t, people p where p.name <> ''";

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
  // The explorer opens the connection's schema cache; navigation reads only what it holds.
  await row.click();
  await page.keyboard.press("ArrowRight");
  await expect(frame.locator("#tree [role=treeitem]", { hasText: "public" })).toBeVisible();
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.console", { connection: "fixture-pg" }),
  );
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await expect(editor).toBeVisible();
  await caretAt(frame, 0);
  return { frame, editor };
}

/** The console's text set to TEXT and the caret put at `at`, focused. */
async function caretAt(frame: Frame, at: number) {
  await frame.evaluate(
    ([text, caret]) => {
      const area = document.getElementById("editor") as HTMLTextAreaElement;
      if (area.value !== text) area.value = text as string;
      area.focus();
      area.setSelectionRange(caret as number, caret as number);
    },
    [TEXT, at],
  );
}

const selection = (frame: Frame) =>
  frame.evaluate(() => {
    const area = document.getElementById("editor") as HTMLTextAreaElement;
    return [area.selectionStart, area.selectionEnd];
  });

test("F12 on a CTE selects its definition, and on a table opens its DDL", async ({ page }) => {
  const { frame } = await open(page);
  await caretAt(frame, TEXT.indexOf(" t,") + 2);
  await page.keyboard.press("F12");
  await expect.poll(() => selection(frame)).toEqual([5, 6]);
  await caretAt(frame, TEXT.indexOf("people") + 2);
  await page.keyboard.press("F12");
  await expect
    .poll(() =>
      frame.evaluate(() => (document.getElementById("editor") as HTMLTextAreaElement).value),
    )
    .toContain("CREATE TABLE");
});

test("resting on a table shows its card, and Alt+F12 a column's", async ({ page }) => {
  const { frame } = await open(page);
  const box = await frame.evaluate((word) => {
    const content = document.querySelector(".cm-content") as HTMLElement;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node.textContent ?? "").indexOf(word);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at + 1);
      range.setEnd(node, at + 3);
      const r = range.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    return null;
  }, "people");
  if (!box) throw new Error("no people in the editor");
  const frameBox = await page.locator(`${SURFACE} iframe`).boundingBox();
  await page.mouse.move((frameBox?.x ?? 0) + box.x, (frameBox?.y ?? 0) + box.y);
  const card = frame.locator(".nav-card");
  await expect(card).toContainText("public.people");
  await expect(card).toContainText("Who buys");
  await expect(card.locator(".nav-card-col")).toContainText(["id", "name", "joined"]);
  await page.screenshot({ path: test.info().outputPath("navigate-card.png") });
  await page.mouse.move(0, 0);
  await expect(card).toHaveCount(0);

  await caretAt(frame, TEXT.indexOf("name") + 1);
  await page.keyboard.press("Alt+F12");
  await expect(card).toContainText("public.people.name");
  await expect(card).toContainText("Full name");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
});

test("Shift+F12 lists the usages, and a console's place brings the caret back", async ({
  page,
}) => {
  const { frame } = await open(page);
  await caretAt(frame, TEXT.indexOf("people") + 1);
  await page.keyboard.press("Shift+F12");
  const panel = frame.locator(".usages");
  await expect(panel.locator("[data-part=summary]")).toContainText("usage");
  await expect(panel.locator("[data-part=summary]")).toContainText("from parsed source");
  const place = panel.locator("[data-usage]", { hasText: "console" }).first();
  await expect(place.locator(".usage-source")).toHaveText("parsed");
  await page.screenshot({ path: test.info().outputPath("navigate-usages.png") });
  await place.click();
  const at = TEXT.indexOf("people");
  await expect.poll(() => selection(frame)).toEqual([at, at + "people".length]);
});
