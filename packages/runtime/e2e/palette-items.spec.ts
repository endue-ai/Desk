import { expect, type FrameLocator, type Locator, type Page, test } from "@playwright/test";

// desk.palette's providers on views.html: its own item search (desk.palette.items over the stub's
// fixture items) and the test caller test.search's "Test results", after the commands.
const VIEWS = '[data-surface="desk.views"]';
const PALETTE = '[data-surface="desk.palette"]';
// A word from one fixture item's title ("Buy groceries", packages/bridge/src/fixtures.ts); the page
// gives test.search.record it as a keyword, so a command matches it too.
const WORD = "groceries";

test.use({ timezoneId: "Asia/Seoul", locale: "en-US" });

async function load(page: Page): Promise<FrameLocator> {
  await page.clock.setFixedTime("2026-10-30T09:00:00+09:00");
  await page.goto("/views.html");
  await page.waitForFunction(() => window.__views !== undefined);
  await page.evaluate(() => window.__views.ready);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  for (const id of ["desk.palette.open", "desk.palette.items", "test.search.find"])
    await expect
      .poll(() => page.evaluate((c) => window.__desk.runtime.commands.has(c), id))
      .toBe(true);
  return page.frameLocator(`${PALETTE} iframe`);
}

/** Open the palette and type `text`. */
async function type(page: Page, palette: FrameLocator, text: string): Promise<void> {
  await page.keyboard.press("Control+K");
  await expect(page.locator(PALETTE)).toBeVisible();
  await expect(palette.getByTestId("query")).toBeFocused();
  await page.keyboard.type(text);
}

/** Move the selection down to `option` with the arrow keys. */
async function select(page: Page, palette: FrameLocator, option: Locator): Promise<void> {
  const options = palette.getByRole("option");
  const target = await option.getAttribute("id");
  const ids = await options.evaluateAll((els) => els.map((el) => el.id));
  const from = await options.evaluateAll((els) =>
    els.findIndex((el) => el.getAttribute("aria-selected") === "true"),
  );
  for (let i = from; i < ids.indexOf(target ?? ""); i++) await page.keyboard.press("ArrowDown");
  await expect(option).toHaveAttribute("aria-selected", "true");
}

/** What test.search's commands were run with, as the page recorded it. */
const searched = (page: Page, id: string) =>
  page.evaluate(
    (c) => window.__views.search.filter((run) => run.id === c).map((run) => run.args),
    id,
  );

test.describe("desk.palette providers", () => {
  test("a query that matches an item lists it under Items, after the commands", async ({
    page,
  }) => {
    const palette = await load(page);
    await type(page, palette, WORD);
    const items = palette.getByRole("group", { name: "Items" });
    const result = items.getByRole("option").filter({ hasText: "Buy groceries" });
    await expect(result).toBeVisible();
    await expect(result).toHaveAttribute("data-kind", "task");
    await expect(result).toHaveAttribute("data-provider", "desk.palette.items");
    const order = await palette
      .getByRole("option")
      .evaluateAll((els) =>
        els.map((el) => (el.hasAttribute("data-provider") ? "result" : "command")),
      );
    expect(order[0]).toBe("command");
    expect(order.indexOf("result")).toBeGreaterThan(order.lastIndexOf("command"));
  });

  test("Enter on an item runs its first action and the item opens in Desk", async ({ page }) => {
    const palette = await load(page);
    await type(page, palette, WORD);
    const result = palette
      .getByRole("group", { name: "Items" })
      .getByRole("option")
      .filter({ hasText: "Buy groceries" });
    await expect(result).toBeVisible();
    await select(page, palette, result);
    await expect(palette.getByTestId("actions")).toContainText("Open in Desk");
    await page.keyboard.press("Enter");
    await expect(page.locator(PALETTE)).toBeHidden();
    await expect(page.locator(VIEWS)).toBeVisible();
    const views = page.frameLocator(`${VIEWS} iframe`);
    await expect(views.locator('[data-component="card"]')).toContainText("Buy groceries");
    const opened = await page.evaluate(() =>
      window.__desk.stub.log
        .filter((e) => e.caller === "desk.views" && e.request.method === "view.get")
        .map((e) => (e.request.params as { id?: string }).id),
    );
    expect(opened).toEqual(["desk.item"]);
  });

  test("another plugin's provider is asked the same way and its actions run", async ({ page }) => {
    const palette = await load(page);
    await type(page, palette, WORD);
    const tests = palette.getByRole("group", { name: "Test results" });
    await expect(tests.getByRole("option")).toHaveCount(2);
    await expect(palette.getByRole("group", { name: "Items" })).toBeVisible();
    const groups = await palette
      .getByRole("group")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(groups).toEqual(["Items", "Test results"]);
    const finds = await searched(page, "test.search.find");
    expect(finds).toContainEqual({ query: WORD, limit: 5 });
    for (const find of finds) expect(find).toMatchObject({ limit: 5 });

    await select(page, palette, tests.getByRole("option").first());
    await page.keyboard.press("Enter");
    await expect(page.locator(PALETTE)).toBeHidden();
    await expect.poll(() => searched(page, "test.search.record")).toEqual([{ n: 1 }]);

    await type(page, palette, WORD);
    await expect(tests.getByRole("option")).toHaveCount(2);
    await select(page, palette, tests.getByRole("option").first());
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(PALETTE)).toBeHidden();
    await expect.poll(() => searched(page, "test.search.record")).toEqual([{ n: 1 }, { n: 2 }]);
  });

  test("a one-letter query asks no provider", async ({ page }) => {
    const palette = await load(page);
    await type(page, palette, "g");
    await expect(palette.getByRole("option").first()).toBeVisible();
    await expect(palette.getByRole("group")).toHaveCount(0);
    expect(await searched(page, "test.search.find")).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.locator(PALETTE)).toBeHidden();
    // Nothing ran but what the palette reads when it opens.
    const ran = await page.evaluate(() =>
      window.__desk.stub.log
        .filter((e) => e.caller === "desk.palette" && e.request.method === "cmd.invoke")
        .map((e) => (e.request.params as { id?: string }).id),
    );
    expect(new Set(ran)).toEqual(new Set(["desk.keys.list", "desk.palette.providers"]));
    expect(await page.evaluate(() => window.__views.search)).toEqual([]);
    await expect(page.locator(VIEWS)).toBeHidden();
  });
});
