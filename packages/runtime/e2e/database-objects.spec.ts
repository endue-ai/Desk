import { expect, type Frame, type Page, test } from "@playwright/test";

// The explorer's operations on objects in endue.database (plugins/database/ui/features/objects/) on
// the fixture's scripted PostgreSQL connection `fixture-pg` (the shop of pg-catalog.ts, answered by
// objects-fixture.ts): a table's menu opened with `m`, its drop dialog listing what depends on it
// with CASCADE a choice of its own that rewrites the script, and a view's source opened with `s` in
// a console of its own and applied after its script is shown. A desk command stands in for the
// palette: it records each title and answers the menu with Drop.
const SURFACE = '[data-surface="endue.database"]';
const LARGE = { width: 898, height: 558 };

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

const iframe = (page: Page) => page.locator(`${SURFACE} iframe`);

/** Open the fixture page and endue.database, with the palette stand-in; resolves with its frame. */
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
        return title.startsWith("Database: table") ? "drop" : "";
      },
    });
  });
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.database" }),
  );
  await expect(iframe(page)).toBeVisible();
  await iframe(page).evaluate((el, { width, height }) => {
    el.style.cssText += `;width:${width}px!important;height:${height}px!important`;
  }, LARGE);
  const frame = await (await iframe(page).elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").nth(1)).toContainText("fixture-pg");
  await expect
    .poll(() => frame.evaluate(() => [innerWidth, innerHeight]))
    .toEqual([LARGE.width, LARGE.height]);
  return frame;
}

/** Open the explorer's rows one after the other by their exact labels, leaving the last selected. */
async function reach(page: Page, frame: Frame, ...labels: string[]) {
  for (const [i, label] of labels.entries()) {
    const row = frame.locator("#tree [role=treeitem]", {
      has: frame.locator(".label", { hasText: new RegExp(`^${label}$`, "u") }),
    });
    await expect(row.first()).toBeVisible();
    await row.first().click();
    if (i < labels.length - 1) await page.keyboard.press("ArrowRight");
  }
}

test("m opens a table's menu; its drop lists what depends on it and CASCADE rewrites the script", async ({
  page,
}) => {
  const frame = await open(page);
  await reach(page, frame, "fixture-pg", "public", "Tables", "orders");
  await page.keyboard.press("m");
  const dialog = frame.locator("form.object-operation");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.__desk.commands.at(-1))).toBe(
    "Database: table public.orders",
  );
  await expect(dialog.locator("h2")).toHaveText("Drop table public.orders");
  await expect(dialog.locator(".object-depends h3").first()).toHaveText(
    "1 object depends on it: CASCADE drops it too",
  );
  await expect(dialog.locator(".object-dependents li")).toHaveText([
    "view public.big_orders",
    "table constraint orders_person_fkey on public.orders",
    "table constraint orders_pkey on public.orders",
    "table constraint orders_total_check on public.orders",
  ]);
  const script = dialog.locator("#object-script");
  await expect(script).toHaveText('DROP TABLE "public"."orders";');
  const cascade = dialog.getByRole("checkbox", { name: /CASCADE/u });
  await expect(cascade).not.toBeChecked();
  await cascade.check();
  await expect(script).toHaveText('DROP TABLE "public"."orders" CASCADE;');
  await expect(dialog.getByRole("button", { name: "Drop" })).toHaveClass(/desk-btn-danger/u);
  const inside = await dialog.evaluate((form) => {
    const r = form.getBoundingClientRect();
    return (
      r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5
    );
  });
  expect(inside, "the dialog inside the page").toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const asked = await page.evaluate(() => window.__desk.commands);
  expect(asked.some((title) => title.startsWith("Run "))).toBe(false);
});

test("s opens a view's source in a console of its own, and apply shows the script and runs it", async ({
  page,
}) => {
  const frame = await open(page);
  await reach(page, frame, "fixture-pg", "public", "Views", "big_orders");
  await page.keyboard.press("s");
  const text = () =>
    frame.evaluate(() => (document.getElementById("editor") as HTMLTextAreaElement).value);
  await expect.poll(text).toMatch(/^CREATE OR REPLACE VIEW "public"\."big_orders" AS\n/u);
  await expect(frame.locator("#status")).toContainText("The source of view public.big_orders");

  void page.evaluate(() => window.__desk.runtime.commands.run("endue.database.apply-source", {}));
  const dialog = frame.locator("form.object-operation");
  await expect(dialog.locator("h2")).toHaveText("Apply the source of view public.big_orders");
  await expect(dialog.locator("#object-script")).toHaveText(await text());
  await expect(dialog.locator(".object-note")).toContainText([
    "CREATE OR REPLACE keeps its grants",
  ]);
  await dialog.getByRole("button", { name: "Apply" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(frame.locator("#status")).toHaveText(
    "Applied the source of view public.big_orders.",
  );
});
