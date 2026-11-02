// Hidden surfaces are unloaded and their state kept (ADR 0070), in the shell: a plugin window wholly
// under another one for desk.display.unload-after loses its frame to a placeholder and gets it back
// when it shows again. Real time here, with the setting at one second.
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
const init = encodeURIComponent(JSON.stringify({ "desk.display.unload-after": 1 }));

test.beforeEach(async ({ page }) => {
  await openShell(page, `?plugins=1&lang=en&init=${init}`);
  await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
});

test("a window wholly under a maximized one is unloaded to a placeholder and loads again when it shows", async ({
  page,
}) => {
  await expect(frame(page, COUNTER).getByRole("button")).toBeVisible();
  // Filling the free area, the focused Hello window covers the Counter window beside it.
  await window_(page, HELLO).locator(".surface-title").dblclick();
  await expect(window_(page, HELLO)).toHaveCSS("width", "1232px");
  await expect(inner(page, COUNTER).locator(".desk-surface-placeholder")).toHaveCount(1);
  await expect(inner(page, COUNTER).locator("iframe")).toHaveCount(0);
  // Hello is in sight and keeps its frame.
  await expect(inner(page, HELLO).locator("iframe")).toHaveCount(1);
  expect(await shellTree(page, `section.surface[data-surface="${COUNTER}"]`)).toMatchSnapshot(
    "placeholder.json",
  );

  // Restored to its tile, Hello no longer covers it: the Counter frame loads again.
  await window_(page, HELLO).locator(".surface-title").dblclick();
  await expect(inner(page, COUNTER).locator(".desk-surface-placeholder")).toHaveCount(0);
  await expect(frame(page, COUNTER).getByRole("button")).toBeVisible();
});

test("a window that stays in sight is never unloaded", async ({ page }) => {
  await page.waitForTimeout(1_500);
  await expect(inner(page, COUNTER).locator("iframe")).toHaveCount(1);
  await expect(inner(page, HELLO).locator("iframe")).toHaveCount(1);
});
