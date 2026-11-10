import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });
const surface = (page: Page, id = 1) => page.locator(`[data-surface="window-${id}"]`);
/**
 * The canvas panned by `dx`, `dy`, as the window manager publishes a Shift + drag's pan (desk-wm on
 * the compositor, ADR 0153; this page has none, `fixture/wm.ts`). The drags, resizes, maximize and
 * the Shift + drag pans themselves are e2e/specs/windows-canvas.spec.ts's, on the desk (#83).
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

test("the canvas map shows a window out of sight, and a press, a drag or a key moves the view", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  const map = page.getByRole("group", { name: "Canvas map" });
  const panNow = () =>
    page.evaluate(() => window.__shell.desk.store.get().pan[1] ?? { x: 0, y: 0 });
  // An empty canvas at the start has nothing to find.
  await expect(map).toHaveCount(0);
  await page.keyboard.press("Meta+n");
  await expect(map).toBeVisible();
  const win = surface(page);
  // The background wheel takes the window out of sight to the left; the map still draws it.
  await page.mouse.move(1200, 600);
  await page.mouse.wheel(1500, 0);
  await expect.poll(panNow).toEqual({ x: -1500, y: 0 });
  await expect(page.locator(".minimap-window")).toHaveCount(1);
  // A press on it brings the view to it: the window comes back with its middle near the centre.
  await page.locator(".minimap-window").click();
  const box = await win.boundingBox();
  if (!box) throw new Error("no window");
  expect(Math.abs(box.x + box.width / 2 - DESK.width / 2)).toBeLessThan(30);
  expect(Math.abs(box.y + box.height / 2 - DESK.height / 2)).toBeLessThan(30);
  // Dragging the part in sight moves the view the same way, many world pixels to one.
  const before = await panNow();
  const frame = await page.locator(".minimap-view").boundingBox();
  if (!frame) throw new Error("no view frame");
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width / 2 + 20, frame.y + frame.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await panNow()).x).toBeLessThan(before.x - 100);
  // Focused, the arrow keys step a quarter of the view and Home goes back to the start.
  await map.focus();
  await page.keyboard.press("Home");
  await expect.poll(panNow).toEqual({ x: 0, y: 0 });
  await page.keyboard.press("ArrowRight");
  await expect.poll(panNow).toEqual({ x: -DESK.width / 4, y: 0 });
  // It folds to one button and opens again.
  await page.getByRole("button", { name: "Fold the canvas map" }).click();
  await expect(map).toBeHidden();
  await page.getByRole("button", { name: "Show the canvas map" }).click();
  await expect(map).toBeVisible();
});
