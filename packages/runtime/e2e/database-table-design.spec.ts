import { expect, type Frame, type Page, test } from "@playwright/test";

// The table form of endue.database (plugins/database/ui/features/table-design/) on the fixture's
// scripted PostgreSQL connection `fixture-pg` (the shop, its designs answered by
// table-design-fixture.ts): a new table from a schema's menu (`o`) and its CREATE growing as columns
// are added, a table's form from its menu inside the page at two sizes, the script written as a name
// is typed and a column added, the dropped column's mark, run in one transaction, and a CONCURRENTLY
// index left out of a dry run. A desk command stands in for the palette: it records each title and
// answers a schema's menu and a table's with the form.
const SURFACE = '[data-surface="endue.database"]';
const FIRST = { width: 400, height: 263 };
const LARGE = { width: 898, height: 558 };
type Size = typeof FIRST;

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

const iframe = (page: Page) => page.locator(`${SURFACE} iframe`);
const resize = (page: Page, { width, height }: Size) =>
  iframe(page).evaluate(
    (el, { width, height }) => {
      el.style.cssText += `;width:${width}px!important;height:${height}px!important`;
    },
    { width, height },
  );

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
        if (title.startsWith("Database: schema")) return "create-table";
        return title.startsWith("Database: table") ? "change-table" : "";
      },
    });
  });
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.database" }),
  );
  await expect(iframe(page)).toBeVisible();
  await resize(page, LARGE);
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

/** The form of public.people, opened from its row's menu. */
async function form(page: Page, frame: Frame) {
  await reach(page, frame, "fixture-pg", "public", "Tables", "people");
  await page.keyboard.press("o");
  await expect(frame.locator("#panel-box .td-title")).toHaveText(
    "Table public.people on fixture-pg · PostgreSQL 17",
  );
  expect(await page.evaluate(() => window.__desk.commands.at(-1))).toBe(
    "Database: table public.people",
  );
}
const key = (frame: Frame, name: string) => frame.locator(`#panel-box [data-key="${name}"]`);
const script = (frame: Frame) => frame.locator('#panel-box [data-part="script"]');

/** Whether the page scrolls sideways, and how many of the form's parts reach past its right edge. */
const layout = (frame: Frame) =>
  frame.evaluate(() => {
    const scroller = document.scrollingElement;
    return {
      sideways: scroller ? scroller.scrollWidth > innerWidth + 1 : false,
      wide: [...document.querySelectorAll<HTMLElement>("#panel-box .td *")].filter(
        (el) => el.getBoundingClientRect().right > innerWidth + 0.5 && !el.closest("pre"),
      ).length,
    };
  });

test("the table form opens from a table's menu and fits the page at 900×600 and at the first size", async ({
  page,
}) => {
  const frame = await open(page);
  await form(page, frame);
  await expect(frame.locator("#panel-box .desk-tab")).toHaveText([
    "Columns (3)",
    "Keys (1)",
    "Foreign keys (0)",
    "Indexes (1)",
    "Table",
  ]);
  await expect(script(frame)).toHaveText("Nothing changes yet.");
  await expect(
    frame.locator("#panel-box").getByRole("button", { name: "Run", exact: true }),
  ).toBeDisabled();
  for (const size of [LARGE, FIRST]) {
    await resize(page, size);
    await expect
      .poll(() => frame.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([size.width, size.height]);
    const seen = await layout(frame);
    expect(seen.sideways, `the page scrolls sideways at ${size.width}`).toBe(false);
    expect(seen.wide, `nothing wider than the page at ${size.width}`).toBe(0);
  }
});

test("a rename and a new column become the script as they are typed, and Run applies it", async ({
  page,
}) => {
  const frame = await open(page);
  await form(page, frame);
  await key(frame, "cols:c2").click();
  await key(frame, "col:c2:name").fill("full_name");
  await expect(script(frame)).toHaveText(
    'BEGIN;\n\nALTER TABLE "public"."people" RENAME COLUMN "name" TO "full_name";\n\nCOMMIT;\n',
  );
  // The click right after typing lands, and keeps what was typed.
  await key(frame, "cols:add").click();
  const name = frame.locator('#panel-box [data-key^="col:n"][data-key$=":name"]');
  await name.fill("note");
  await frame.locator('#panel-box [data-key^="col:n"][data-key$=":type"]').fill("text");
  await expect(script(frame)).toContainText(
    'ALTER TABLE "public"."people" RENAME COLUMN "name" TO "full_name";\n\nALTER TABLE "public"."people" ADD COLUMN "note" text;',
  );
  await expect(frame.locator("#panel-box .td-item-title")).toHaveText([
    "id",
    "full_name",
    "joined",
    "note",
  ]);
  await name.press("ControlOrMeta+Enter");
  await expect(frame.locator('#panel-box [data-part="result"]')).toHaveText("Done: 2 steps ran.");
  const asked = await page.evaluate(() => window.__desk.commands);
  expect(asked.some((title) => title.startsWith("Run "))).toBe(false);
});

test("a dropped column is marked, and a CONCURRENTLY index is left out of a dry run", async ({
  page,
}) => {
  const frame = await open(page);
  await form(page, frame);
  await key(frame, "cols:c3").click();
  await key(frame, "col:c3:drop").click();
  await expect(frame.locator("#panel-box .td-mark")).toHaveText([
    "-- Drops column joined and its data for good.",
  ]);
  await expect(key(frame, "col:c3:drop")).toHaveText("Keep column");
  await key(frame, "tab:indexes").click();
  await key(frame, "idx:add").click();
  const added = frame.locator('#panel-box [data-key^="idx:n"][data-key$=":keys:add"]');
  await added.click();
  await frame.locator('#panel-box [data-key$=":keys:0:pick"]').selectOption({ label: "name" });
  await frame.locator("#panel-box").getByRole("checkbox", { name: "CONCURRENTLY" }).check();
  await expect(script(frame)).toContainText(
    'COMMIT;\n\n-- CONCURRENTLY: runs after the transaction, on its own, while writes go on; if it fails, an invalid index is left to drop.\nCREATE INDEX CONCURRENTLY ON "public"."people" USING "btree" ("name");',
  );
  await frame.locator("#panel-box").getByRole("button", { name: "Dry run" }).click();
  await expect(frame.locator('#panel-box [data-part="result"]')).toHaveText(
    "The dry run went through and rolled back: 1 step would apply. The CONCURRENTLY indexes are not part of a dry run.",
  );
});

test("a new table from a schema's menu, its CREATE growing as columns are added", async ({
  page,
}) => {
  const frame = await open(page);
  await reach(page, frame, "fixture-pg", "public");
  await page.keyboard.press("o");
  await expect(frame.locator("#panel-box .td-title")).toHaveText(
    "New table in public on fixture-pg · PostgreSQL 17",
  );
  expect(await page.evaluate(() => window.__desk.commands.at(-1))).toBe("Database: schema public");
  await expect(frame.locator('#panel-box [data-part="problems"]')).toHaveText(
    "The table has no name.",
  );
  await key(frame, "table:name").fill("events");
  await expect(frame.locator('#panel-box [data-part="problems"]')).toHaveCount(0);
  await key(frame, "cols:add").click();
  await frame.locator('#panel-box [data-key^="col:n"][data-key$=":name"]').fill("id");
  await frame.locator('#panel-box [data-key^="col:n"][data-key$=":type"]').fill("bigint");
  await frame.locator('#panel-box [data-key^="col:n"][data-key$=":pk"]').check();
  await expect(script(frame)).toHaveText(
    'BEGIN;\n\nCREATE TABLE "public"."events" (\n    "id" bigint NOT NULL,\n    PRIMARY KEY ("id")\n);\n\nCOMMIT;\n',
  );
  await key(frame, "cols:add").click();
  await frame.locator('#panel-box [data-key^="col:n"][data-key$=":name"]').fill("kind");
  await frame.locator('#panel-box [data-key^="col:n"][data-key$=":type"]').fill("text");
  await expect(script(frame)).toContainText('    "id" bigint NOT NULL,\n    "kind" text,\n');
  await expect(
    frame.locator("#panel-box").getByRole("button", { name: "Run", exact: true }),
  ).toBeEnabled();
});
