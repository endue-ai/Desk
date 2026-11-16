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

// #296: the strip under the canvas map, which the compositor draws 64 above the app's bottom, 24
// from its right (92 under 734 high), 202 wide with its padding (`draw_map.rs`).
test("the strip under the map holds the name, the Drawer and the origin, and the origin is disabled at rest", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  const strip = page.locator(".map-strip");
  const box = await strip.boundingBox();
  expect(box).toEqual({
    x: DESK.width - 24 - 202,
    y: DESK.height - 32 - 32,
    width: 202,
    height: 32,
  });
  await expect(strip.locator(".map-strip-name")).toHaveText("Desktop 1");
  await expect(strip.locator(".drawer-button")).toBeVisible();
  const reset = strip.locator(".canvas-reset");
  await expect(reset).toBeVisible();
  await expect(reset).toBeDisabled();
  await pan(page, -300, -200);
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(reset).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => window.__shell.desk.store.get().pan[1] ?? { x: 0, y: 0 }))
    .toEqual({ x: 0, y: 0 });
  // In a short app the map and its strip move clear of the rail.
  await page.setViewportSize({ width: 1280, height: 700 });
  await expect
    .poll(async () => {
      const r = await strip.boundingBox();
      return r && [1280 - (r.x + r.width), 700 - (r.y + r.height)];
    })
    .toEqual([92, 32]);
});
