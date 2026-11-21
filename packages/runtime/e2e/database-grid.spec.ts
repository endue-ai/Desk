import { expect, type Frame, type Page, test } from "@playwright/test";

// The result grid of endue.database (plugins/database, #469) on the browser stub with the scripted
// sqlite3 over the fixture tables (plugins/database/tests/fixtures.ts: people with id, name, note and
// team): columns hidden, moved, pinned and resized by key and by the pointer, a quick filter and a
// sort by two columns in a console's result and on the server in a table view, find with Mod+F, and
// a table view's columns again after the plugin's page loads again.
const SURFACE = '[data-surface="endue.database"]';
const SIZE = { width: 898, height: 558 };

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

async function frameOf(page: Page) {
  const iframe = page.locator(`${SURFACE} iframe`);
  await expect(iframe).toBeVisible();
  await iframe.evaluate((el, { width, height }) => {
    el.style.cssText += `;width:${width}px!important;height:${height}px!important`;
  }, SIZE);
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").first()).toContainText("fixture");
  return frame;
}

async function open(page: Page) {
  await page.goto("/database.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.database" }),
  );
  return frameOf(page);
}

const run = (page: Page, command: string, args: Record<string, unknown>) =>
  page.evaluate(([command, args]) => window.__desk.runtime.commands.run(command, args), [
    command,
    args,
  ] as const);

async function query(page: Page, frame: Frame) {
  await run(page, "endue.database.console", { connection: "fixture" });
  const editor = frame.locator("#editor");
  await editor.click();
  await editor.fill("select * from people;");
  await editor.press("ControlOrMeta+Enter");
  await expect(frame.locator("#summary")).toContainText("Done");
  await expect(frame.locator("#result [role=gridcell]").first()).toHaveText("1");
}

async function people(page: Page, frame: Frame) {
  await run(page, "endue.database.open-table", {
    connection: "fixture",
    schema: "main",
    table: "people",
  });
  await expect(frame.locator("#page")).toHaveText("1–4");
}

const headers = (frame: Frame) =>
  frame
    .locator("#result [role=columnheader]")
    .evaluateAll((all) => all.map((h) => (h as HTMLElement).dataset.key));
const header = (frame: Frame, key: string) =>
  frame.locator(`#result [role=columnheader][data-key="${key}"]`);
/** The text of a screen column's cells, top to bottom. */
const column = (frame: Frame, key: string) =>
  frame.evaluate((key) => {
    const head = document.querySelector(`#result [role=columnheader][data-key="${key}"]`);
    const index = head?.getAttribute("aria-colindex");
    return [...document.querySelectorAll("#result .body [role=row]")].map(
      (row) => row.querySelector(`[aria-colindex="${index}"]`)?.textContent ?? "",
    );
  }, key);
const cell = (frame: Frame, text: string) =>
  frame.locator("#result .body [role=gridcell]", { hasText: new RegExp(`^${text}$`, "u") });

test("a result's columns hide, move, pin and resize, by key and by the pointer", async ({
  page,
}) => {
  const frame = await open(page);
  await query(page, frame);
  expect(await headers(frame)).toEqual(["id", "name", "note", "team"]);
  await cell(frame, "1").click();
  await frame.locator("#result [role=grid]").press("h");
  expect(await headers(frame)).toEqual(["name", "note", "team"]);
  await expect(frame.locator("#result [role=grid]")).toHaveAttribute("aria-colcount", "3");
  await frame.locator("#result [role=grid]").press(">");
  expect(await headers(frame)).toEqual(["note", "name", "team"]);
  // Drag team's header before note's.
  const from = await header(frame, "team").boundingBox();
  const to = await header(frame, "note").boundingBox();
  if (!from || !to) throw new Error("no headers");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();
  expect(await headers(frame)).toEqual(["team", "note", "name"]);
  // Pin name: it moves to the left and stays there while the rest scroll.
  await cell(frame, "Ada").click();
  await frame.locator("#result [role=grid]").press("P");
  expect(await headers(frame)).toEqual(["name", "team", "note"]);
  await expect(header(frame, "name")).toHaveClass(/pinned/u);
  // Resize note by its grip, wide enough to scroll; then fit it to its content.
  const note = await header(frame, "note").boundingBox();
  if (!note) throw new Error("no note header");
  await page.mouse.move(note.x + note.width - 2, note.y + note.height / 2);
  await page.mouse.down();
  await page.mouse.move(note.x + note.width + 900, note.y + note.height / 2, { steps: 6 });
  await page.mouse.up();
  const wide = await header(frame, "note").boundingBox();
  expect(wide?.width ?? 0).toBeGreaterThan(note.width + 800);
  const pinned = await header(frame, "name").boundingBox();
  await frame.locator("#result .scroller").evaluate((el) => {
    el.scrollLeft = 400;
    el.dispatchEvent(new Event("scroll"));
  });
  await expect.poll(async () => (await header(frame, "name").boundingBox())?.x).toBe(pinned?.x);
  await frame.locator("#result .scroller").evaluate((el) => {
    el.scrollLeft = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  await header(frame, "note").locator(".grip").dblclick();
  await expect
    .poll(async () => (await header(frame, "note").boundingBox())?.width)
    .toBeLessThan(200);
});

test("a quick filter and a sort by two columns, on the rows held and on the server", async ({
  page,
}) => {
  const frame = await open(page);
  await query(page, frame);
  const grid = frame.locator("#result [role=grid]");
  await cell(frame, "red").first().click();
  await grid.press("=");
  expect(await column(frame, "name")).toEqual(["Ada", "Cy"]);
  const strip = frame.locator(".grid-strip");
  await expect(strip).toContainText("On these rows");
  await expect(strip).toContainText("team = 'red'");
  await strip.locator("[data-remove]").first().click();
  expect(await column(frame, "name")).toEqual(["Ada", "Bob", "Cy", "Dee"]);
  await header(frame, "team").click();
  await header(frame, "name").click({ modifiers: ["Shift"] });
  await header(frame, "name").click({ modifiers: ["Shift"] });
  expect(await column(frame, "name")).toEqual(["Dee", "Bob", "Cy", "Ada"]);
  await expect(header(frame, "team")).toHaveAttribute("aria-sort", "ascending");
  await expect(header(frame, "name").locator(".sort")).toHaveText("▼2");
  // A table view asks the server: the filter joins the WHERE, the keys are the ORDER BY.
  await people(page, frame);
  await cell(frame, "red").first().click();
  await grid.press("=");
  await expect(frame.locator("#page")).toHaveText("1–2");
  await expect(strip).toContainText("On the server");
  await expect(frame.locator("#where")).toHaveValue("");
  const order = frame.locator("#order");
  await header(frame, "name").click();
  await expect(order).toHaveValue('"name" ASC');
  await header(frame, "id").click({ modifiers: ["Shift"] });
  await expect(order).toHaveValue('"name" ASC, "id" ASC');
  // A plain click sorts by that column alone: ascending, descending, then as the server sends.
  await header(frame, "name").click();
  await expect(order).toHaveValue('"name" ASC');
  await header(frame, "name").click();
  await expect(order).toHaveValue('"name" DESC');
  await expect.poll(() => column(frame, "name")).toEqual(["Cy", "Ada"]);
  await header(frame, "name").click();
  await expect(order).toHaveValue("");
});

test("find in the result with Mod+F: next, previous and the count", async ({ page }) => {
  const frame = await open(page);
  await query(page, frame);
  await cell(frame, "1").click();
  await frame.locator("#result [role=grid]").press("ControlOrMeta+f");
  const find = frame.locator(".grid-find input");
  await expect(find).toBeFocused();
  await find.fill("i");
  const count = frame.locator(".grid-find [role=status]");
  await expect(count).toHaveText("1 of 2");
  await expect(frame.locator("#result .cell.cursor")).toHaveText("first");
  await find.press("Enter");
  await expect(count).toHaveText("2 of 2");
  await expect(frame.locator("#result .cell.cursor")).toHaveText("third");
  await find.press("Shift+Enter");
  await expect(count).toHaveText("1 of 2");
  await frame.locator('.grid-find [data-find="whole"]').click();
  await find.fill("Dee");
  await expect(count).toHaveText("1 of 1");
  await expect(frame.locator("#result .cell.cursor")).toHaveText("Dee");
  await find.press("Escape");
  await expect(frame.locator(".grid-find")).toBeHidden();
  await expect(frame.locator("#result [role=grid]")).toBeFocused();
  // The editor's Mod+F is the editor's.
  await frame.locator("#editor").click();
  await frame.locator("#editor").press("ControlOrMeta+f");
  await expect(frame.locator(".grid-find")).toBeHidden();
});

test("a table view's columns come back after the plugin's page loads again", async ({ page }) => {
  let frame = await open(page);
  await people(page, frame);
  await cell(frame, "first").click();
  await frame.locator("#result [role=grid]").press("h");
  expect(await headers(frame)).toEqual(["id", "name", "team"]);
  // The store keeps it a moment after the change.
  await page.waitForTimeout(600);
  await frame.evaluate(() => location.reload());
  frame = await frameOf(page);
  await people(page, frame);
  await expect.poll(() => headers(frame)).toEqual(["id", "name", "team"]);
});
