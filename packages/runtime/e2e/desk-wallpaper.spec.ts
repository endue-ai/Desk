import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell, step } from "./shell-helpers";

test.use({ viewport: DESK });
/**
 * The canvas panned by `dx`, `dy`, as the window manager publishes a Shift + drag's pan (desk-wm on
 * the compositor, ADR 0153; this page has none, `fixture/wm.ts`).
 */
const pan = (page: Page, dx: number, dy: number) =>
  page.evaluate(([x, y]) => window.__shell.wm.panBy(x, y), [dx, dy] as const);

test("Eris has idle, hover and editing states with keyboard and pointer input", async ({
  page,
}, info) => {
  await openShell(page, "?lang=en");
  const pill = page.locator(".talk-pill");
  await expect(pill).toHaveAttribute("data-state", "idle");
  await expect(pill).toHaveCSS("width", "184px");
  await page.screenshot({ path: info.outputPath("talk-idle.png") });
  await pill.hover();
  await expect(pill).toHaveAttribute("data-state", "hover");
  await expect(pill).toHaveCSS("width", "400px");
  await expect(page.locator(".composer-input")).not.toBeFocused();
  await page.screenshot({ path: info.outputPath("talk-hover.png") });
  await page.getByRole("button", { name: "Talk to Eris", exact: true }).click();
  await step(page, 240);
  await expect(pill).toHaveAttribute("data-state", "edit");
  await expect(pill).toHaveCSS("height", "72px");
  await expect(page.locator(".composer-input")).toBeFocused();
  await page.screenshot({ path: info.outputPath("talk-edit.png") });
  await page.keyboard.type("hello pond");
  await page.keyboard.press("Enter");
  await expect(page.locator(".absorb")).toHaveText("hello pond");
  await page.mouse.move(1000, 600);
  await page.keyboard.press("Alt+Space");
  await expect(page.locator(".composer-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pill).toHaveAttribute("data-state", "idle");
});

test("Appearance chooses a wallpaper and retains it after restart", async ({ page }) => {
  await openShell(page, "?lang=en&persist=1");
  await page.evaluate(() => localStorage.clear());
  await openShell(page, "?lang=en&persist=1");
  await page.keyboard.press("Meta+,");
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("button", { name: "Appearance", exact: true })
    .click();
  await page.getByRole("combobox", { name: "Wallpaper", exact: true }).selectOption("pond");
  await expect(page.locator(".wallpaper")).toHaveAttribute("data-scene", "pond");
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();
  await page.keyboard.press("Escape");
  await openShell(page, "?lang=en&persist=1");
  await expect(page.locator(".wallpaper")).toHaveAttribute("data-scene", "pond");
  await page.evaluate(() => localStorage.clear());
});

test("the empty desk, normal windows and pond scenery share one pan; floating windows can return without a jump", async ({
  page,
}, info) => {
  await openShell(page, '?lang=en&init={"desk.wallpaper.scene":"pond"}');
  await pan(page, -120, 60);
  await expect(page.locator(".wallpaper")).toHaveCSS("--wallpaper-x", "-120px");
  await page.keyboard.press("Meta+n");
  const win = page.locator('[data-surface="window-1"]');
  await expect(win).toHaveAttribute("data-floating", "false");
  await expect(page.locator(".wallpaper-ripple")).toHaveCount(1);
  await step(page, 800);
  const ripple = page.locator(".wallpaper-ripple");
  const rippleBefore = await ripple.boundingBox();
  const before = await win.boundingBox();
  if (!before || !rippleBefore) throw new Error("The window and ripple must be visible");
  await page.screenshot({ path: info.outputPath("pond-window-ripple.png") });
  await pan(page, -90, -40);
  expect(await win.boundingBox()).toEqual({ ...before, x: before.x - 90, y: before.y - 40 });
  expect(await ripple.boundingBox()).toEqual({
    ...rippleBefore,
    x: rippleBefore.x - 90,
    y: rippleBefore.y - 40,
  });
  await win.getByRole("button", { name: "Floating mode" }).click();
  const floating = await win.boundingBox();
  await pan(page, 60, 20);
  expect(await win.boundingBox()).toEqual(floating);
  await win.getByRole("button", { name: "Floating mode" }).click();
  expect(await win.boundingBox()).toEqual(floating);
  await expect(page.locator(".wallpaper-ripple")).toHaveCount(1);
  await step(page, 3200);
  await expect(page.locator(".wallpaper-ripple")).toHaveCount(0);
});

test("plugin side windows use the same normal and floating modes", async ({ page }) => {
  await openShell(page, '?lang=en&edges=1&init={"desk.wallpaper.scene":"pond"}');
  await page.evaluate(() =>
    window.__shell.desk.runtime.commands.run("desk.profiles.switch", { id: "default" }),
  );
  for (const id of ["endue.sidebar", "endue.toolbar"]) {
    const win = page.locator(`.surface[data-surface="${id}"]`);
    await expect(win).toHaveAttribute("data-floating", "false");
    const before = await win.boundingBox();
    if (!before) throw new Error("The plugin window must be visible");
    await pan(page, -100, 50);
    expect(await win.boundingBox()).toEqual({ ...before, x: before.x - 100, y: before.y + 50 });
    await win.getByRole("button", { name: "Floating mode" }).click();
    const floating = await win.boundingBox();
    await pan(page, -100, -50);
    expect(await win.boundingBox()).toEqual(floating);
    await win.getByRole("button", { name: "Floating mode" }).click();
    expect(await win.boundingBox()).toEqual(floating);
  }
  await page
    .frameLocator('.surface[data-surface="endue.toolbar"] iframe')
    .getByRole("button")
    .first()
    .focus();
  await page.keyboard.press("Alt+Space");
  await expect(page.locator(".composer-input")).toBeFocused();
});

test("live scenery respects reduced motion", async ({ page }) => {
  await openShell(page, '?lang=en&reduced=1&init={"desk.wallpaper.scene":"pond"}');
  await page.keyboard.press("Meta+n");
  await expect(page.locator(".wallpaper-ripple")).toHaveCount(0);
  await expect(page.locator(".wallpaper")).toHaveAttribute("data-motion", "still");
  // An idle wallpaper needs only the final clock frame, without a burst of unrelated Eris paints.
  await page.evaluate(() => window.__shell.clock.advance(5000));
  await expect(page.locator(".wallpaper")).toHaveCSS("--wallpaper-drift", "0px");
});
