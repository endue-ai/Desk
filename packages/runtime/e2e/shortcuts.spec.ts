// The shortcut bar (ADR 0274, `src/system/ShortcutBar.ts`): hung under the profile switcher above
// the agent bar, in the bars' one shape, the agent bar 12 under it however many it holds; Search
// opens the palette; its "+" puts a plugin on it whose button opens the plugin's window, kept
// through a reload; a shortcut's menu takes it off; it goes past the left edge with the agent bar
// while a window fills the app.
import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });

const bar = (page: Page) => page.locator("#desk .shortcuts");
const shortcut = (page: Page, key: string) =>
  page.locator(`#desk .shortcuts [data-shortcut="${key}"]`);

/** A part's box as drawn, whole pixels. */
async function box(page: Page, selector: string) {
  const b = await page.locator(`#desk ${selector}`).first().boundingBox();
  if (!b) throw new Error(`no ${selector}`);
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    w: Math.round(b.width),
    h: Math.round(b.height),
  };
}

/** Put shortcuts on the bar as desk.shortcuts.add does for a plugin or an agent. */
const add = (page: Page, shortcuts: object[]) =>
  page.evaluate(async (all) => {
    for (const s of all) await window.__shell.desk.runtime.commands.run("desk.shortcuts.add", s);
  }, shortcuts);

test("hangs under the profile switcher in the bars' shape; the agent bar keeps 12 under it", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  const shape = await bar(page).evaluate((el) => {
    const style = getComputedStyle(el);
    return [style.borderRadius, style.borderWidth, style.borderStyle, style.boxShadow];
  });
  expect(shape).toEqual(["16px", "1px", "solid", "none"]);
  // Search and the "+": two buttons of 36 with 4 between them and a bar's 8 of padding and border.
  const shortcuts = await box(page, ".shortcuts");
  expect(shortcuts).toEqual({ x: 16, y: 116, w: 52, h: 92 });
  for (const button of await bar(page).locator("button").all()) {
    const b = await button.boundingBox();
    expect([b?.width, b?.height]).toEqual([36, 36]);
  }
  // Centred 88 above the middle would put the agent bar's top above the shortcut bar's bottom.
  expect((await box(page, ".sidebar")).y).toBe(116 + 92 + 12);

  // Five more: the bar grows, the agent bar follows it down and keeps 200 from the bottom.
  await add(page, [
    { command: "desk.settings.open" },
    { command: "desk.inbox.open" },
    { command: "desk.theme.studio" },
    { command: "desk.windows.tile" },
    { command: "desk.shell.talk" },
  ]);
  await expect(bar(page).locator("button")).toHaveCount(7);
  const grown = await box(page, ".shortcuts");
  expect(grown.h).toBe(7 * 36 + 6 * 4 + 16);
  const agents = await box(page, ".sidebar");
  expect(agents.y).toBe(grown.y + grown.h + 12);
  expect(agents.y + agents.h).toBeLessThanOrEqual(900 - 200);
});

test("Search opens the palette", async ({ page }) => {
  await openShell(page, "?lang=en");
  await expect
    .poll(() => page.evaluate(() => window.__shell.desk.runtime.commands.has("desk.palette.open")))
    .toBe(true);
  await shortcut(page, "command:desk.palette.open").click();
  await expect(page.locator('[data-surface="desk.palette"]')).toBeVisible();
});

test("the + puts a plugin on the bar, its button opens it, and the bar keeps it through a reload", async ({
  page,
}) => {
  await openShell(page, "?apps=1&persist=1&lang=en");
  await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
  await bar(page).locator('[data-key="shortcuts-add"]').click();
  const list = page.locator("#desk .shortcuts-popover");
  await expect(list).toBeVisible();
  await expect(list.locator(".shortcuts-filter")).toBeFocused();
  await page.keyboard.type("term");
  // The plugin first, its name starting so; then its commands, a word of whose names does.
  await expect(list.locator(".shortcuts-choice .pop-text")).toHaveText([
    "Terminal",
    "Focus the terminal",
    "New terminal",
  ]);
  await page.keyboard.press("Enter");
  await expect(shortcut(page, "plugin:endue.terminal")).toHaveAttribute("aria-label", "Terminal");
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(bar(page).locator('[data-key="shortcuts-add"]')).toBeFocused();

  await shortcut(page, "plugin:endue.terminal").click();
  await expect(page.locator('section.surface[data-surface="endue.terminal"]')).toBeVisible();

  await page.reload();
  await page.waitForFunction(() => window.__shell !== undefined);
  await page.evaluate(() => window.__shell.desk.ready);
  await expect(bar(page).locator(".shortcut")).toHaveCount(2);
  expect(
    await bar(page)
      .locator(".shortcut")
      .evaluateAll((all) => all.map((el) => el.getAttribute("data-shortcut"))),
  ).toEqual(["command:desk.palette.open", "plugin:endue.terminal"]);

  // Its menu takes it off.
  await shortcut(page, "plugin:endue.terminal").click({ button: "right" });
  await page.locator('#desk .shortcut-menu [data-key="shortcut-menu-remove"]').click();
  await expect(shortcut(page, "plugin:endue.terminal")).toHaveCount(0);
  await expect(page.locator("#desk .shortcut-menu")).toHaveCount(0);
});

test("goes past the left edge with the agent bar while a window fills the app", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  const rest = await box(page, ".shortcuts");
  await page.evaluate(async () => {
    await window.__shell.wm.desktop(1);
    await window.__shell.wm.session({
      1: {
        surfaces: [
          { id: "notes", plugin: "endue.shell", x: 600, y: 300, w: 420, h: 320, pinned: false },
        ],
        eris: null,
        rail: { visible: true },
        drawer: { visible: true },
      },
    });
    await window.__shell.wm.focus("notes");
    await window.__shell.wm.fill("notes", "full");
  });
  await expect(page.locator("#desk")).toHaveClass(/is-away/);
  await expect(bar(page)).toBeHidden();
  await expect(page.locator("#desk .sidebar")).toBeHidden();
  // The pointer at the left edge brings both back, the shortcut bar where it rests.
  await page.mouse.move(2, 400);
  await expect(bar(page)).toBeVisible();
  await expect.poll(() => box(page, ".shortcuts")).toEqual(rest);
});
