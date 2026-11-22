import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.database's connections file (#452, PG-15, ADR 0332) on the browser stub: the export
// dialog's ticked connections written through the save dialog into the fixture's files without a
// password, and the fixture's connections file in ~/Transfer previewed (a change, a new one, a name
// taken here) and imported into the tree. Both dialogs stay inside the page at two sizes.
const SURFACE = '[data-surface="endue.database"]';
const FIRST = { width: 400, height: 263 };
const LARGE = { width: 898, height: 558 };
type Size = typeof FIRST;
type Box = { left: number; top: number; right: number; bottom: number };

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

const iframe = (page: Page) => page.locator(`${SURFACE} iframe`);
const resize = (page: Page, { width, height }: Size) =>
  iframe(page).evaluate(
    (el, { width, height }) => {
      el.style.cssText += `;width:${width}px!important;height:${height}px!important`;
    },
    { width, height },
  );

/** Open the fixture page and endue.database at `size`, resolving with its frame once the tree shows. */
async function open(page: Page, size: Size) {
  await page.goto("/database.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.database" }),
  );
  await expect(iframe(page)).toBeVisible();
  await resize(page, size);
  const frame = await (await iframe(page).elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(
    frame.locator("#tree [role=treeitem]", { hasText: "fixture" }).first(),
  ).toBeVisible();
  await expect
    .poll(() => frame.evaluate(() => [innerWidth, innerHeight]))
    .toEqual([size.width, size.height]);
  return frame;
}

/** Run a desk command and leave it running: the form it shows waits for the person. The forms are
 * worked by keys: the page's window stays at its first size while its frame is made larger, so a
 * pointer would land on the window around it. */
const start = (page: Page, command: string, args: Record<string, unknown>) =>
  page.evaluate(
    ([command, args]) => {
      window.__desk.runtime.commands.run(command, args).catch(() => {});
    },
    [command, args] as const,
  );

/** Whether the page itself scrolls, and the box of `selector`. */
const layout = (frame: Frame, selector: string) =>
  frame.evaluate((selector) => {
    const r = document.querySelector(selector)?.getBoundingClientRect();
    const scroller = document.scrollingElement;
    return {
      view: { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
      scrolls: scroller
        ? scroller.scrollHeight > innerHeight + 1 || scroller.scrollWidth > innerWidth + 1
        : false,
      box: r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null,
    };
  }, selector);
const within = (a: Box | null, b: Box) =>
  a !== null &&
  a.left >= b.left - 0.5 &&
  a.right <= b.right + 0.5 &&
  a.top >= b.top - 0.5 &&
  a.bottom <= b.bottom + 0.5;

/** The form stays inside the page at both sizes, and the page itself never scrolls. */
async function fits(page: Page, frame: Frame, selector: string) {
  for (const size of [FIRST, LARGE]) {
    await resize(page, size);
    await expect
      .poll(() => frame.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([size.width, size.height]);
    const seen = await layout(frame, selector);
    expect(seen.scrolls, `the page scrolls at ${size.width}`).toBe(false);
    expect(within(seen.box, seen.view), `${selector} inside the page at ${size.width}`).toBe(true);
  }
}

test("export writes the ticked connections without a password", async ({ page }) => {
  const frame = await open(page, LARGE);
  await start(page, "endue.database.export-connections", {});
  const form = frame.locator("form.connections-file");
  await expect(form.locator("h2")).toHaveText("Export connections");
  await expect(form.locator('[data-part="count"]')).toHaveText("6 of 6 to export");
  await fits(page, frame, "form.connections-file");
  await form.locator('[data-ctl="none"]').press("Enter");
  await expect(form.locator('button[type="submit"]')).toBeDisabled();
  await form.locator('input[value="c-fixture"]').press("Space");
  await form.locator('button[type="submit"]').press("Enter");
  await expect(form).toBeHidden();
  const written = await page.evaluate(() => {
    const files = (window as unknown as { __files: Record<string, string> }).__files;
    const path = Object.keys(files).find((p) => /^~\/Transfer\/connections-/u.test(p));
    return path ? files[path] : undefined;
  });
  expect(written).toBeDefined();
  const file = JSON.parse(written as string);
  expect(file).toMatchObject({ format: "endue.database.connections", version: 1 });
  expect(file.connections.map((c: { name: string }) => c.name)).toEqual(["fixture"]);
  expect(written).not.toMatch(/pass|keychain/iu);
});

test("import previews the file and adds what is ticked", async ({ page }) => {
  const frame = await open(page, LARGE);
  await start(page, "endue.database.import-connections", {});
  const form = frame.locator("form.connections-file");
  await expect(form.locator("h2")).toHaveText("Import connections from team-connections.json");
  const rows = form.locator(".connections-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-kind", "change");
  await expect(rows.nth(0)).toContainText("Changes environment, read-only.");
  await expect(rows.nth(1)).toHaveAttribute("data-kind", "add");
  await expect(rows.nth(2)).toHaveAttribute("data-kind", "taken");
  await expect(form.locator('[data-part="count"]')).toHaveText("2 of 3 to import");
  await fits(page, frame, "form.connections-file");
  await rows.nth(2).locator("input").press("Space");
  await expect(rows.nth(2)).toContainText("Imported as Warehouse (2).");
  await form.locator('button[type="submit"]').press("Enter");
  await expect(form).toBeHidden();
  for (const name of ["team reports", "Warehouse (2)"])
    await expect(frame.locator("#tree [role=treeitem]", { hasText: name }).first()).toBeVisible();
});
