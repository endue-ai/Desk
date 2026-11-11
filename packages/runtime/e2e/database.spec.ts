import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.database (plugins/database) on the browser stub with a saved SQLite connection whose sqlite3
// is scripted (plugins/database/tests/fixtures.ts: people and orders), in the sandboxed frame a plugin
// page gets. "First size" is the page of a window as the desk first opens one: 402×305 less its
// 40 px title bar and border; "cascade" is the 643×339 a cascade gives; "large" a 900×600 window.
const SURFACE = '[data-surface="endue.database"]';
const FIRST = { width: 400, height: 263 };
const CASCADE = { width: 641, height: 297 };
const LARGE = { width: 898, height: 558 };
type Size = typeof FIRST;
type Box = { left: number; top: number; right: number; bottom: number };

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

/** Open the fixture page and endue.database at `size`, and resolve with its frame once the tree shows. */
async function open(page: Page, size: Size) {
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
  }, size);
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").first()).toContainText("fixture");
  await expect
    .poll(() => frame.evaluate(() => [innerWidth, innerHeight]))
    .toEqual([size.width, size.height]);
  return frame;
}

const run = (page: Page, command: string, args: Record<string, unknown>) =>
  page.evaluate(([command, args]) => window.__desk.runtime.commands.run(command, args), [
    command,
    args,
  ] as const);

/** The boxes of the first match of each selector (null when none shows). */
const boxes = (frame: Frame, selectors: string[]) =>
  frame.evaluate((selectors) => {
    const out: Record<string, Box | null> = {};
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const r = el?.getBoundingClientRect();
      out[selector] =
        r && r.width > 0 && r.height > 0
          ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
          : null;
    }
    return out;
  }, selectors);

const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const within = (a: Box, b: Box) =>
  a.left >= b.left - 0.5 &&
  a.right <= b.right + 0.5 &&
  a.top >= b.top - 0.5 &&
  a.bottom <= b.bottom + 0.5;

/** The page's own box, and whether anything makes the page itself scroll. */
const viewport = (frame: Frame) =>
  frame.evaluate(() => ({
    box: { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
    scrolls: document.scrollingElement
      ? document.scrollingElement.scrollHeight > innerHeight + 1 ||
        document.scrollingElement.scrollWidth > innerWidth + 1
      : false,
  }));

/** A console on the fixture connection, `select * from people;` run with Mod+Enter. */
async function query(page: Page, frame: Frame) {
  await run(page, "endue.database.console", { connection: "fixture" });
  const editor = frame.locator("#editor");
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.fill("select * from people;");
  await editor.press("ControlOrMeta+Enter");
  await expect(frame.locator("#summary")).toContainText("Done");
  await expect(frame.locator("#result [role=gridcell]").first()).toHaveText("1");
}

for (const [name, size] of [
  ["the first size", FIRST],
  ["643×339", CASCADE],
] as const) {
  test(`at ${name} a query's rows are in sight and nothing is drawn over the content`, async ({
    page,
  }) => {
    const frame = await open(page, size);
    await query(page, frame);
    const view = await viewport(frame);
    expect(view.scrolls, "the page itself scrolls").toBe(false);
    const b = await boxes(frame, [
      "header",
      "#actions",
      "footer",
      "#tree",
      "#filter",
      "#editor-box",
      "#grid-bar",
      "#result",
      "#result .body [role=row]",
    ]);
    const row = b["#result .body [role=row]"];
    expect(row, "the first result row").not.toBeNull();
    if (!row || !b["#result"]) return;
    expect(within(row, view.box), "the first row inside the page").toBe(true);
    expect(within(row, b["#result"]), "the first row inside the result").toBe(true);
    // One row of actions: the rest are behind More.
    expect(b["#actions"] && b["#actions"].bottom - b["#actions"].top).toBeLessThanOrEqual(32);
    for (const part of ["#tree", "#filter", "#editor-box", "#grid-bar", "#result"]) {
      const box = b[part];
      expect(box, part).not.toBeNull();
      if (!box) continue;
      for (const over of ["footer", "header"])
        expect(overlaps(box, b[over] as Box), `${over} over ${part}`).toBe(false);
    }
  });
}

test("the actions that do not fit are behind More, each once, and run from there", async ({
  page,
}) => {
  const frame = await open(page, FIRST);
  await run(page, "endue.database.console", { connection: "fixture" });
  await expect(frame.locator("#editor")).toBeVisible();
  const shown = await frame.locator("#actions > [data-act]:visible").allTextContents();
  const more = frame.locator("#actions-more");
  await expect(more).toBeVisible();
  await more.click();
  const menu = frame.locator("#actions-menu");
  await expect(menu).toBeVisible();
  const behind = await menu.locator("[data-action]:visible").allTextContents();
  expect(shown.length).toBeGreaterThanOrEqual(2);
  expect([...shown, ...behind]).toHaveLength(13);
  expect(new Set([...shown, ...behind]).size).toBe(13);
  // The menu lies inside the page.
  const b = await boxes(frame, ["#actions-menu"]);
  const view = await viewport(frame);
  expect(b["#actions-menu"] && within(b["#actions-menu"], view.box)).toBe(true);
  // A second press on More closes it, and Escape gives More the focus back.
  await more.click();
  await expect(menu).toBeHidden();
  await more.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
  // Format from the menu formats the script.
  await frame.locator("#editor").fill("select   1");
  await more.click();
  await menu.locator('[data-action="format"]').click();
  await expect(menu).toBeHidden();
  await expect(frame.locator("#editor")).toHaveValue("SELECT 1");
  // A wider page shows more of them in the row; at 1200 px all of them, and More is gone.
  const resize = (width: number) =>
    page
      .locator(`${SURFACE} iframe`)
      .evaluate((el, width) => (el.style.cssText += `;width:${width}px!important`), width);
  await resize(LARGE.width);
  await expect
    .poll(() => frame.locator("#actions > [data-act]:visible").count())
    .toBeGreaterThan(shown.length + 4);
  await resize(1200);
  await expect(more).toBeHidden();
  await expect(frame.locator("#actions > [data-act]:visible")).toHaveCount(13);
});

for (const [name, size] of [
  ["the first size", FIRST],
  ["643×339", CASCADE],
] as const) {
  test(`at ${name} the connection form's buttons are in sight, its fields scroll inside it`, async ({
    page,
  }) => {
    const frame = await open(page, size);
    await frame.locator('[data-act="create"]').click();
    const form = frame.locator("#form");
    await expect(form).toBeVisible();
    await expect(frame.locator("#f-name")).toBeFocused();
    const view = await viewport(frame);
    expect(view.scrolls, "the page itself scrolls").toBe(false);
    const parts = ["#form", "#form-test", "#form-cancel", '#form [type="submit"]'];
    const b = await boxes(frame, parts);
    for (const part of parts) expect(b[part] && within(b[part], view.box), part).toBe(true);
    // Tab to the last field: it scrolls into sight above the buttons.
    await frame.locator("#f-readOnly").focus();
    const last = await boxes(frame, ["#f-readOnly", "#form .buttons"]);
    expect(last["#f-readOnly"] && within(last["#f-readOnly"], view.box)).toBe(true);
    expect(overlaps(last["#f-readOnly"] as Box, last["#form .buttons"] as Box)).toBe(false);
  });
}

/** The people table in a table view. */
async function people(page: Page, frame: Frame) {
  await run(page, "endue.database.open-table", {
    connection: "fixture",
    schema: "main",
    table: "people",
  });
  await expect(frame.locator("#page")).toHaveText("1–4");
}

test("a table's filter, order and pager are one row at 900×600", async ({ page }) => {
  const frame = await open(page, LARGE);
  await people(page, frame);
  const tops = await frame.evaluate(() =>
    ["#where", "#order", '[data-page="-1"]', "#page", '[data-page="1"]', "#count"].map((s) => {
      const r = document.querySelector(s)?.getBoundingClientRect();
      return r ? r.top + r.height / 2 : -1;
    }),
  );
  const [first] = tops;
  for (const middle of tops) expect(Math.abs(middle - (first ?? 0))).toBeLessThanOrEqual(2);
});

test("a double click on a cell opens its editor", async ({ page }) => {
  const frame = await open(page, LARGE);
  await people(page, frame);
  const bob = frame.locator("#result [role=gridcell]", { hasText: /^Bob$/ });
  await expect(bob).toBeVisible();
  // The edit target is known once the columns are read.
  await expect(frame.locator('[data-act="addRow"]')).toBeVisible();
  await bob.dblclick();
  const input = frame.locator("#result .cell-input");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Bob");
});
