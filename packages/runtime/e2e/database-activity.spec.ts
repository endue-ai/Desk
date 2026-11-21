import { expect, type Frame, type Page, test } from "@playwright/test";

// The server's activity in endue.database (plugins/database/ui/features/activity/) on the fixture's
// scripted PostgreSQL connection `warehouse` (plugins/database/tests/activity-fixture.ts): the
// sessions, who waits for whom and the locks inside the page at two sizes, and a cancel from the
// panel that asks first (a desk command stands in for the palette and answers yes) and reads again.
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
  await expect(frame.locator("#tree [role=treeitem]").first()).toContainText("fixture");
  await expect
    .poll(() => frame.evaluate(() => [innerWidth, innerHeight]))
    .toEqual([size.width, size.height]);
  return frame;
}

/** The activity panel of `warehouse`, read once. */
async function activity(page: Page, frame: Frame) {
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.activity", { connection: "warehouse" }),
  );
  await expect(frame.locator('[data-part="sessions"] tbody tr').first()).toBeVisible();
}

/** Whether the page itself scrolls, and the panel box's and the toolbar's boxes. */
const layout = (frame: Frame) =>
  frame.evaluate(() => {
    const box = (selector: string) => {
      const r = document.querySelector(selector)?.getBoundingClientRect();
      return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
    };
    const scroller = document.scrollingElement;
    return {
      view: { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
      scrolls: scroller
        ? scroller.scrollHeight > innerHeight + 1 || scroller.scrollWidth > innerWidth + 1
        : false,
      panel: box("#panel-box"),
      refresh: box('#panel-box [data-ctl="refresh"]'),
    };
  });
const within = (a: Box | null, b: Box) =>
  a !== null &&
  a.left >= b.left - 0.5 &&
  a.right <= b.right + 0.5 &&
  a.top >= b.top - 0.5 &&
  a.bottom <= b.bottom + 0.5;

test("the activity panel shows sessions, the tree and locks inside the page at 900×600 and at the first size", async ({
  page,
}) => {
  const frame = await open(page, LARGE);
  await activity(page, frame);
  await expect(frame.locator('[data-part="sessions"] tbody tr')).toHaveCount(5);
  await expect(frame.locator('[data-part="tree"]')).toContainText("ShareLock on transaction 731");
  await expect(frame.locator('[data-part="locks"] tbody tr').first()).toContainText("waiting");
  await expect(frame.locator('[data-part="notice"]')).toContainText("pg_read_all_stats");
  for (const size of [LARGE, FIRST]) {
    await resize(page, size);
    await expect
      .poll(() => frame.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([size.width, size.height]);
    const seen = await layout(frame);
    expect(seen.scrolls, `the page scrolls at ${size.width}`).toBe(false);
    expect(within(seen.panel, seen.view), `the panel inside the page at ${size.width}`).toBe(true);
    expect(within(seen.refresh, seen.view), `Refresh in sight at ${size.width}`).toBe(true);
  }
  // Filters change what shows: idle sessions come in.
  await frame.locator('[data-ctl="idle"]').click();
  await expect(frame.locator('[data-part="sessions"] tbody tr')).toHaveCount(6);
});

test("cancel from the panel asks first, then reads again", async ({ page }) => {
  const frame = await open(page, LARGE);
  await page.evaluate(() => {
    window.__desk.runtime.commands.define("desk.palette.pick", {
      title: "Pick",
      owner: "desk",
      run: (args) => {
        window.__desk.commands.push(String((args as { title?: string }).title));
        return "yes";
      },
    });
  });
  await activity(page, frame);
  const row = frame.locator('[data-part="sessions"] tr[data-pid="4242"]');
  await row.click();
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(frame.locator(".activity-query")).toHaveText("SELECT pg_sleep(600)");
  await frame.locator('.activity-details [data-ctl="cancel"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__desk.commands.at(-1)))
    .toBe("Cancel the statement of session 4242 on warehouse?");
  await expect(row).toContainText("idle in transaction (aborted)");
});
