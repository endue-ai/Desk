// A window's tabs (ADR 0270): the shell fixture with ?plugins=1, whose test plugins open in the
// shell's windows. The title bar's New tab opens another window of the window's plugin (ADR 0212)
// as a tab of that window: a page of its own, shown one at a time under the strip of tabs, and
// never a window of its own. Which tab a window takes is desk-wm's (crates/desk-wm/tests/tabs.rs).
import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });

const COUNTER = "test.counter";
const SECOND = `${COUNTER}@2`;
const window_ = (page: Page, id = COUNTER) => page.locator(`section.surface[data-surface="${id}"]`);
const inner = (page: Page, id = COUNTER) => page.locator(`.desk-surface[data-surface="${id}"]`);
const frame = (page: Page, id = COUNTER) =>
  page.frameLocator(`.desk-surface[data-surface="${id}"] iframe`);
const tabs = (page: Page) => window_(page).locator("[data-tab]");
const shown = (page: Page) => window_(page).locator('[data-tab][aria-selected="true"]');
const newTab = (page: Page) => window_(page).getByRole("button", { name: /New tab/ });

test.describe("a window's tabs", () => {
  test.beforeEach(async ({ page }) => {
    await openShell(page, "?plugins=1&lang=en");
    await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
    await expect(frame(page).getByRole("button")).toBeVisible();
  });

  test("a new tab is another window of the plugin, in the same window", async ({ page }) => {
    await expect(window_(page).locator(".tab-strip")).toBeHidden();
    await newTab(page).click();
    await expect(tabs(page)).toHaveCount(2);
    await expect(window_(page).locator(".tab-strip")).toBeVisible();
    await expect(shown(page)).toHaveAttribute("data-tab", "p2");
    // A page of its own, where the first one was; the first is out of sight, not gone.
    await expect(frame(page, SECOND).getByRole("button")).toBeVisible();
    await expect(inner(page)).toBeHidden();
    await expect(inner(page)).toHaveCount(1);
    // The plugin's second window is that tab: no window of its own opens for it.
    await expect(window_(page, SECOND)).toHaveCount(0);
    await expect(page.locator("section.surface")).toHaveCount(2);
  });

  test("a press on a tab shows it, and its page is the one that was there", async ({ page }) => {
    const button = frame(page).getByRole("button");
    await button.click();
    const counted = await button.textContent();
    await newTab(page).click();
    await expect(frame(page, SECOND).getByRole("button")).toBeVisible();
    await tabs(page).first().click();
    await expect(shown(page)).toHaveAttribute("data-tab", "p1");
    await expect(inner(page)).toBeVisible();
    await expect(inner(page, SECOND)).toBeHidden();
    // Never loaded again: it still shows what it counted.
    await expect(button).toHaveText(counted ?? "");
    // The keys step through the tabs too.
    await page.evaluate(() => window.__shell.desk.runtime.commands.run("desk.display.next-tab"));
    await expect(shown(page)).toHaveAttribute("data-tab", "p2");
  });

  test("closing a tab closes its page alone, and the last tab leaves no strip", async ({
    page,
  }) => {
    await newTab(page).click();
    await expect(frame(page, SECOND).getByRole("button")).toBeVisible();
    await window_(page).locator('[data-tab="p2"] .tab-close').click();
    await expect(tabs(page)).toHaveCount(1);
    await expect(window_(page).locator(".tab-strip")).toBeHidden();
    await expect(inner(page, SECOND)).toHaveCount(0);
    await expect(inner(page)).toBeVisible();
    await expect(frame(page).getByRole("button")).toBeVisible();
  });
});
