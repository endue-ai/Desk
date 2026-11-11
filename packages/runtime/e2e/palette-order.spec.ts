import { expect, type Page, test } from "@playwright/test";

// desk.palette on desk.html: the row Enter runs is the first one, whatever arrives ahead of it, and
// the list a person sees first is ordered for them (#158: draft 04 findings 11 and 12).
const palette = '[data-surface="desk.palette"]';
const frame = (page: Page) => page.frameLocator(`${palette} iframe`);

async function open(page: Page) {
  await page.goto("/desk.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await expect
    .poll(() => page.evaluate(() => window.__desk.runtime.commands.has("desk.palette.open")))
    .toBe(true);
}

test("a plugin's hit that arrives ahead of a command is the selected row, and Enter opens it", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(async () => {
    const { runtime, stub } = window.__desk;
    await stub.call({
      id: 900,
      method: "plugin.setEnabled",
      params: { plugin: "test.counter", enabled: false, scope: { permission: "plugin:manage" } },
    });
    // As Docker's "open a shell" lists "terminal": a command with the plugin's name as a keyword.
    runtime.commands.define("test.tally.open", {
      title: "Open a tally",
      keywords: ["counter"],
      owner: "desk",
      run: () => {
        window.__desk.commands.push("test.tally.open");
      },
    });
    await runtime.commands.settled();
  });
  await expect(page.locator('[data-surface="test.counter"]')).toHaveCount(0);
  await page.keyboard.press("Control+K");
  await page.keyboard.type("counter");
  const first = frame(page).getByRole("option").first();
  await expect(first).toHaveAttribute("data-id", "plugin:test.counter");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.locator(palette)).toBeHidden();
  await expect(page.locator('[data-surface="test.counter"]')).toBeVisible();
  expect(await page.evaluate(() => window.__desk.commands)).toEqual([]);
});

test("the first list is the plugins, then the commands A to Z; its key again closes it", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("Control+K");
  await expect(frame(page).getByTestId("query")).toBeFocused();
  const groups = frame(page).getByRole("group");
  await expect(groups.first()).toHaveAttribute("aria-label", "Plugins");
  await expect(frame(page).getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  const plugins = frame(page).getByRole("group", { name: "Plugins" });
  await expect(plugins.locator('[data-id="plugin:test.echo"]')).toHaveCount(1);
  const commands = frame(page).getByRole("group", { name: "Commands" });
  const labels = await commands.locator(".label").allTextContents();
  expect(labels.length).toBeGreaterThan(20);
  const sorted = await page.evaluate(
    (all) =>
      [...all].sort(new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare),
    labels,
  );
  expect(labels).toEqual(sorted);
  await page.keyboard.press("Control+K");
  await expect(page.locator(palette)).toBeHidden();
});
