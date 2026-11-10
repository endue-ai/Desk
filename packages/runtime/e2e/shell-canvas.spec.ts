import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });
const surface = (page: Page, id = 1) => page.locator(`[data-surface="window-${id}"]`);
/**
 * The canvas panned by `dx`, `dy`, as the window manager publishes a Shift + drag's pan (desk-wm on
 * the compositor, ADR 0153; this page has none, `fixture/wm.ts`). The drags, resizes, maximize and
 * the Shift + drag pans themselves are e2e/specs/windows-canvas.spec.ts's, on the desk (#83), and the
 * canvas map, which the compositor draws, is e2e/specs/windows-map.spec.ts's (#54).
 */
const pan = (page: Page, dx: number, dy: number) =>
  page.evaluate(([x, y]) => window.__shell.wm.panBy(x, y), [dx, dy] as const);

test("a move on a panned canvas stores world coordinates and restores the panned session", async ({
  page,
}) => {
  await openShell(page, "?lang=en&persist=1");
  await page.evaluate(() => localStorage.clear());
  await openShell(page, "?lang=en&persist=1");
  await page.keyboard.press("Meta+n");
  const win = surface(page);
  await pan(page, -100, -50);
  await page.evaluate(() => window.__shell.wm.move("window-1", 80, 40));
  const moved = await win.boundingBox();
  expect(
    await page.evaluate(() => {
      const p = window.__shell.desk.store.get().session[1]?.surfaces[0];
      return p && { x: p.x, y: p.y };
    }),
  ).toEqual({ x: 560, y: 280 });
  await page.waitForTimeout(400);
  await openShell(page, "?lang=en&persist=1");
  await expect(win).toHaveAttribute("data-floating", "false");
  expect(await win.boundingBox()).toEqual(moved);
  await page.evaluate(() => localStorage.clear());
});

test("wheel over a pane does not pan, background wheel does", async ({ page }) => {
  await openShell(page, "?lang=en");
  await page.keyboard.press("Meta+n");
  const win = surface(page);
  await win.locator('[data-view="notes"]').click();
  const before = await win.boundingBox();
  await win.locator("textarea.notes-input").hover();
  await page.mouse.wheel(0, 120);
  expect(await win.boundingBox()).toEqual(before);
  await page.mouse.move(1200, 700);
  await page.mouse.wheel(0, 120);
  await expect
    .poll(() => page.evaluate(() => window.__shell.desk.store.get().pan[1]?.y))
    .toBe(-120);
});

// #2: the canvas pan is the only way the view moves. Focusing a control under an edge, revealing
// it, or a script setting scrollTop leaves the shell and every bar where they are.
test("the shell never scrolls: revealing a control under the edge moves no bar", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  await page.keyboard.press("Meta+n");
  const win = surface(page);
  await expect(win).toBeVisible();
  const rail = page.locator(".rail");
  const before = await rail.boundingBox();
  await pan(page, 0, 500);
  const under = win.locator(".launcher button").last();
  expect((await under.boundingBox())?.y).toBeGreaterThan(DESK.height);
  await under.evaluate((el) => (el as HTMLElement).focus());
  await under.evaluate((el) => el.scrollIntoView());
  await page.evaluate(() => {
    const shell = document.querySelector(".shell");
    if (shell) shell.scrollTop = 300;
  });
  const scrolled = await page.evaluate(() => {
    const shell = document.querySelector(".shell");
    return [shell?.scrollTop, shell?.scrollLeft, document.scrollingElement?.scrollTop];
  });
  expect(scrolled).toEqual([0, 0, 0]);
  expect(await rail.boundingBox()).toEqual(before);
});
