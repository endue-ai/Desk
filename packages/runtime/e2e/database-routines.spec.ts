import { expect, type Frame, type Page, test } from "@playwright/test";

// The routine forms of endue.database (plugins/database/ui/features/routines/) on the fixture's
// scripted PostgreSQL connection `warehouse` (plugins/database/tests/routine-fixture.ts): a field
// per argument inside the page at two sizes, the call drawn again as a value is typed, run with
// Mod+Enter into the console's result grid, and a VOLATILE function run rolled back with its
// notice in Messages.
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

/** The form of one of warehouse's routines, read once. */
async function form(page: Page, frame: Frame, args: Record<string, unknown>) {
  await page.evaluate(
    (args) =>
      window.__desk.runtime.commands.run("endue.database.routine", {
        connection: "warehouse",
        ...args,
      }),
    args,
  );
  await expect(frame.locator("#panel-box .routine-title")).toContainText(`public.${args.name}(`);
}

/** Whether the page itself scrolls, and how many of the form's parts reach past its right edge. */
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
      wide: [...document.querySelectorAll<HTMLElement>("#panel-box .routine *")].filter(
        (el) => el.getBoundingClientRect().right > innerWidth + 0.5 && !el.closest("pre"),
      ).length,
    };
  });
const within = (a: Box | null, b: Box) =>
  a !== null &&
  a.left >= b.left - 0.5 &&
  a.right <= b.right + 0.5 &&
  a.top >= b.top - 0.5 &&
  a.bottom <= b.bottom + 0.5;

test("the routine form draws a field per argument inside the page at 900×600 and at the first size", async ({
  page,
}) => {
  const frame = await open(page, LARGE);
  await form(page, frame, { name: "recent_orders" });
  await expect(frame.locator('[data-part="facts"]')).toHaveText(
    "Returns TABLE(id integer, total numeric) · sql · STABLE: it only reads, so it runs as a read.",
  );
  await expect(frame.locator(".routine-arg-head")).toHaveText([
    "sinceINdate",
    "statusINorder_statusDEFAULT 'paid'::order_status",
    "idTABLEinteger",
    "totalTABLEnumeric",
  ]);
  for (const size of [LARGE, FIRST]) {
    await resize(page, size);
    await expect
      .poll(() => frame.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([size.width, size.height]);
    const seen = await layout(frame);
    expect(seen.scrolls, `the page scrolls at ${size.width}`).toBe(false);
    expect(within(seen.panel, seen.view), `the panel inside the page at ${size.width}`).toBe(true);
    expect(seen.wide, `nothing wider than the page at ${size.width}`).toBe(0);
  }
  // A date typed, an enum's label picked: the call follows.
  await resize(page, LARGE);
  await frame.locator('[data-arg="1"] input').first().fill("2026-11-01");
  await frame.locator('[data-arg="2"] [data-choice="value"]').click();
  await frame.locator('[data-arg="2"] [role="option"]', { hasText: "shipped" }).click();
  await expect(frame.locator('[data-part="statement"]')).toHaveText(
    "SELECT * FROM public.recent_orders(since => '2026-11-01'::date, status => 'shipped'::order_status)",
  );
  await frame.locator('[data-arg="2"] [data-choice="null"]').click();
  await expect(frame.locator('[data-part="statement"]')).toHaveText(
    "SELECT * FROM public.recent_orders(since => '2026-11-01'::date, status => NULL::order_status)",
  );
});

test("runs a function from its form with Mod+Enter into the console's result grid", async ({
  page,
}) => {
  const frame = await open(page, LARGE);
  await form(page, frame, { name: "add_tax" });
  await expect(frame.locator('[data-part="problem"]')).toContainText("amount:");
  await expect(frame.locator('[data-ctl="run"]')).toBeDisabled();
  const amount = frame.locator('[data-arg="1"] input').first();
  await amount.fill("100");
  await expect(frame.locator('[data-part="statement"]')).toHaveText(
    "SELECT public.add_tax(amount => 100::numeric)",
  );
  await amount.press("ControlOrMeta+Enter");
  await expect(frame.locator("#summary")).toContainText("Done");
  await expect(frame.locator("#result [role=gridcell]").first()).toHaveText("120.00");
  // The form again: its values kept for the session, and how its last run ended.
  await form(page, frame, { name: "add_tax" });
  await expect(frame.locator('[data-arg="1"] input').first()).toHaveValue("100");
  await expect(frame.locator('[data-part="last"]')).toContainText("Last run, in the console");
});

test("runs a VOLATILE function rolled back and shows its notice in Messages", async ({ page }) => {
  const frame = await open(page, LARGE);
  await form(page, frame, { name: "archive_orders", arguments: { before: "2026-01-01" } });
  await expect(frame.locator('[data-part="facts"]')).toContainText("VOLATILE: it may change data");
  await frame.locator('[data-ctl="rollback"]').check();
  const run = frame.locator('[data-ctl="run"]');
  await expect(run).toHaveText("Run and roll back");
  await run.click();
  await expect(frame.locator("#summary")).toContainText("rolled back (dry run)");
  await expect(frame.locator("#result [role=gridcell]").first()).toHaveText("3");
  await frame.locator("#tabs [role=tab]", { hasText: "Messages" }).click();
  await expect(frame.locator("#result")).toContainText("3 orders archived");
});
