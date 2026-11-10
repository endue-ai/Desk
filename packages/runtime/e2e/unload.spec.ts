// Hidden surfaces are unloaded and their state kept (ADR 0070), in the shell: a plugin window the
// live budget leaves out loses its frame to a placeholder and gets it back when the budget lets it in
// again. Which windows keep a frame is desk-wm's to decide (`LiveBudget`, ADR 0151, #83: a window
// wholly under a fill is out of sight, crates/desk-wm tests/host.rs); this page has no compositor, so
// it names the set the budget would (`fixture/wm.ts`'s `keep`), and the runtime carries it out.
import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";
import { shellTree } from "./shell-tree";

test.use({ viewport: DESK });

const COUNTER = "test.counter";
const HELLO = "example.hello-ui";
const window_ = (page: Page, id: string) => page.locator(`section.surface[data-surface="${id}"]`);
const inner = (page: Page, id: string) => page.locator(`.desk-surface[data-surface="${id}"]`);
const frame = (page: Page, id: string) =>
  page.frameLocator(`.desk-surface[data-surface="${id}"] iframe`);
const init = encodeURIComponent(JSON.stringify({}));
const maximize = (page: Page, id: string) =>
  page.evaluate((w) => window.__shell.wm.fill(w, "full"), id);
const restore = (page: Page, id: string) => page.evaluate((w) => window.__shell.wm.unfill(w), id);
/** The windows the compositor's live budget would keep. */
const keep = (page: Page, ids: string[]) =>
  page.evaluate((kept) => window.__shell.wm.keep(kept), ids);

test.beforeEach(async ({ page }) => {
  await openShell(page, `?plugins=1&lang=en&init=${init}`);
  await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
});

test("a window the budget leaves out (wholly under a maximized one) is unloaded to a placeholder and loads again when it is let in", async ({
  page,
}) => {
  await expect(frame(page, COUNTER).getByRole("button")).toBeVisible();
  // Filled and focused, Hello is drawn over the whole app, Counter's slot included: the budget
  // keeps Hello alone.
  await window_(page, HELLO).locator(".surface-name").click();
  await maximize(page, HELLO);
  await expect(window_(page, HELLO)).toHaveCSS("width", "1440px");
  await keep(page, [HELLO]);
  await expect(inner(page, COUNTER).locator(".desk-surface-placeholder")).toHaveCount(1);
  await expect(inner(page, COUNTER).locator("iframe")).toHaveCount(0);
  // Hello is in sight and keeps its frame.
  await expect(inner(page, HELLO).locator("iframe")).toHaveCount(1);
  expect(await shellTree(page, `section.surface[data-surface="${COUNTER}"]`)).toMatchSnapshot(
    "placeholder.json",
  );

  // Restored to its slot, Hello no longer covers it: the budget lets Counter in, and it loads again.
  await restore(page, HELLO);
  await keep(page, [HELLO, COUNTER]);
  await expect(inner(page, COUNTER).locator(".desk-surface-placeholder")).toHaveCount(0);
  await expect(frame(page, COUNTER).getByRole("button")).toBeVisible();
});

test("a window that loads again does not take the focus when its page focuses itself", async ({
  page,
}) => {
  await window_(page, HELLO).locator(".surface-name").click();
  await maximize(page, HELLO);
  await keep(page, [HELLO]);
  await expect(inner(page, COUNTER).locator(".desk-surface-placeholder")).toHaveCount(1);
  await restore(page, HELLO);
  await keep(page, [HELLO, COUNTER]);
  await expect(frame(page, COUNTER).getByRole("button")).toBeVisible();
  // The person is in the desk's own page; the Counter page focuses its button as it shows, as many
  // plugins do when they mount.
  await page.locator(".desktop-button").first().focus();
  await frame(page, COUNTER)
    .getByRole("button")
    .evaluate((button) => (button as HTMLElement).focus());
  await page.waitForTimeout(200);
  const focused = await page.evaluate(() =>
    document.activeElement?.closest("[data-surface]")?.getAttribute("data-surface"),
  );
  expect(focused).not.toBe(COUNTER);
  await expect(page.locator(".desktop-button").first()).toBeFocused();
});

test("with no live budget deciding, every window keeps its frame", async ({ page }) => {
  await page.waitForTimeout(1_500);
  await expect(inner(page, COUNTER).locator("iframe")).toHaveCount(1);
  await expect(inner(page, HELLO).locator("iframe")).toHaveCount(1);
});
