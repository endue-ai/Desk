import { expect, test } from "@playwright/test";
import { DESK, openShell, primaryFills, step } from "./shell-helpers";
import { shellTree } from "./shell-tree";

test.use({ viewport: DESK });

test.describe("the desk shell", () => {
  test.beforeEach(async ({ page }) => {
    await openShell(page);
  });

  test("every edge part is there and the centre is empty", async ({ page }) => {
    await step(page, 1000);
    for (const selector of [
      ".modes",
      ".desktops",
      ".sidebar",
      ".eris",
      ".rail",
      ".drawer",
      ".composer",
      ".running",
    ]) {
      await expect(page.locator(selector)).toBeVisible();
    }
    await expect(page.locator(".rail-button")).toHaveCount(7);
    await expect(page.locator(".surface")).toHaveCount(0);
    expect(await primaryFills(page)).toBeLessThanOrEqual(1);
    expect(await shellTree(page)).toMatchSnapshot("default.json");
  });

  test("modes unfold on hover and fold away again", async ({ page }) => {
    await page.hover(".mode-chip.is-current");
    await step(page, 400);
    await expect(page.locator(".modes-more .mode-chip")).toHaveCount(4);
    await expect(page.locator(".modes-more")).toHaveCSS("max-width", "720px");
    await expect(page.locator('[data-mode="studio"] .mode-copied')).toHaveText("jin");
    expect(await shellTree(page, ".modes")).toMatchSnapshot("modes-open.json");
    await page.mouse.move(700, 600);
    await step(page, 400);
    await expect(page.locator(".modes-more")).toHaveCSS("max-width", "0px");
  });

  test("+ saves the desk as it is as a new mode, asking only for a name", async ({ page }) => {
    await page.click(".mode-add");
    const dialog = page.getByRole("dialog", { name: "지금 이대로 저장" });
    await expect(dialog.locator("input")).toHaveCount(1);
    await expect(dialog.locator("input")).toBeFocused();
    expect(await primaryFills(page)).toBe(1);
    await page.keyboard.type("Focus");
    await page.keyboard.press("Enter");
    await expect(page.locator(".mode-chip.is-current")).toHaveAttribute("data-mode", "focus");
  });

  test("a changed layout shows the dot and offers save, save as new, revert", async ({ page }) => {
    await page.click('[data-desktop="2"]');
    const title = page.locator('[data-surface="calendar"] .surface-title');
    const dragBy = async (dx: number) => {
      const box = await title.boundingBox();
      if (!box) throw new Error("no title bar");
      await page.mouse.move(box.x + 60, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x + 60 + dx, box.y + 20, { steps: 4 });
      await page.mouse.up();
    };
    await dragBy(100);
    const dot = page.locator(".mode-chip.is-current .mode-dirty");
    await expect(dot).toBeVisible();
    await page.click(".mode-chip.is-current");
    await expect(page.getByRole("menuitem")).toHaveText([
      "이 모드에 저장",
      "새 모드로",
      "되돌리기",
    ]);
    await page.getByRole("menuitem", { name: "되돌리기" }).click();
    await expect(dot).toHaveCount(0);
    await expect(page.locator('[data-surface="calendar"]')).toHaveCSS("left", "120px");
    await dragBy(100);
    await page.click(".mode-chip.is-current");
    await page.getByRole("menuitem", { name: "이 모드에 저장" }).click();
    await expect(dot).toHaveCount(0);
    await expect(page.locator('[data-surface="calendar"]')).toHaveCSS("left", "220px");
    await dragBy(40);
    await page.click(".mode-chip.is-current");
    await page.getByRole("menuitem", { name: "새 모드로" }).click();
    await expect(page.getByRole("dialog", { name: "지금 이대로 저장" })).toBeVisible();
  });

  test("switching modes sends surfaces the new mode lacks to the drawer", async ({ page }) => {
    await page.click('[data-desktop="2"]');
    await page.hover(".mode-chip.is-current");
    await step(page, 400);
    await page.click('[data-mode="deep-work"]');
    await expect(page.locator(".mode-chip.is-current")).toHaveAttribute("data-mode", "deep-work");
    await expect(page.locator(".drawer-button .badge")).toHaveText("5");
  });

  test("desktops switch by click and by ⌃1–⌃4, and show which are empty", async ({ page }) => {
    await expect(page.locator('[data-desktop="1"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-desktop="2"] .mini-dot.is-on')).toHaveCount(2);
    await expect(page.locator('[data-desktop="4"] .mini-dot.is-on')).toHaveCount(0);
    await page.click('[data-desktop="2"]');
    await expect(page.locator(".surface")).toHaveCount(2);
    await page.keyboard.press("Control+3");
    await expect(page.locator('[data-desktop="3"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".surface")).toHaveCount(1);
    await page.keyboard.press("Control+1");
    await expect(page.locator(".surface")).toHaveCount(0);
  });

  test("the rail shows a tooltip on hover and a popover on click; Esc closes it", async ({
    page,
  }) => {
    await page.hover('[data-rail="brain"]');
    await expect(page.getByRole("tooltip")).toHaveText("두뇌 · 로컬 · llama-3.2-3b");
    await expect(page.locator('[data-rail="brain"]')).toHaveAttribute(
      "aria-label",
      "두뇌 · 로컬 · llama-3.2-3b",
    );
    await page.click('[data-rail="brain"]');
    await page.getByRole("radio", { name: "클라우드" }).click();
    await expect(page.locator('[data-rail="brain"]')).toHaveAttribute(
      "aria-label",
      "두뇌 · 클라우드 · 크레딧 1200",
    );
    await expect(page.locator('[data-rail="brain"] .dot-info')).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator(".rail-popover")).toHaveCount(0);
    await page.click('[data-rail="listen"]');
    await expect(page.locator('[data-rail="listen"] .rail-dot')).toHaveCount(0);
  });

  test("the drawer opens upwards and raises an item onto the desk", async ({ page }) => {
    await page.click(".drawer-button");
    const panel = page.getByRole("dialog", { name: "서랍" });
    await expect(panel.locator(".drawer-item")).toHaveCount(3);
    await panel.locator('[data-item="recent-weather"] button').click();
    await expect(page.locator('[data-surface="recent:recent-weather"]')).toBeVisible();
    await expect(page.locator('[data-surface="recent:recent-weather"] .eris-badge')).toHaveText(
      "Eris 가 만듦",
    );
    await expect(page.locator(".drawer-button .badge")).toHaveText("2");
  });

  test("⌘K opens the line, commands run with Enter, a message rises and is absorbed", async ({
    page,
  }) => {
    await expect(page.locator(".composer-field")).toHaveCSS("height", "2px");
    await page.keyboard.press("Meta+k");
    await step(page, 220);
    await expect(page.locator(".composer-field")).toHaveCSS("height", "48px");
    await page.keyboard.type("calendar");
    await expect(page.getByRole("option").first()).toHaveText("열기 · 캘린더");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-surface="calendar"]')).toBeVisible();
    await page.keyboard.press("Meta+k");
    await page.keyboard.type("night");
    await page.keyboard.press("Enter");
    await expect(page.locator(".mode-chip.is-current")).toHaveAttribute("data-mode", "night");
    await page.keyboard.press("Meta+k");
    await page.keyboard.type("hello there");
    await expect(page.getByRole("option").last()).toHaveText("Eris 에게 말하기 · hello there");
    await page.keyboard.press("Enter");
    await expect(page.locator(".absorb")).toHaveText("hello there");
    await step(page, 700);
    const mid = await page
      .locator(".absorb")
      .evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    await step(page, 720);
    await expect(page.locator(".absorb")).toHaveCount(0);
    await step(page, 1000);
    await expect(page.locator(".soul-live")).toHaveText(
      'I\'ll look into "hello there" and tell you.',
    );
    await page.keyboard.press("Meta+k");
    await page.keyboard.press("Escape");
    await step(page, 220);
    await expect(page.locator(".composer-field")).toHaveCSS("height", "2px");
  });

  test("surfaces drag, resize and go into the drawer", async ({ page }) => {
    await page.click('[data-desktop="2"]');
    const calendar = page.locator('[data-surface="calendar"]');
    const title = calendar.locator(".surface-title");
    const box = await title.boundingBox();
    if (!box) throw new Error("no title");
    await page.mouse.move(box.x + 60, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 64, box.y + 22);
    await expect(calendar).toHaveCSS("left", "120px");
    await page.mouse.move(box.x + 110, box.y + 60, { steps: 4 });
    await page.mouse.up();
    await expect(calendar).toHaveCSS("left", "170px");
    await expect(calendar).toHaveCSS("top", "280px");
    const grip = await calendar.locator(".surface-resize").boundingBox();
    if (!grip) throw new Error("no grip");
    await page.mouse.move(grip.x + 8, grip.y + 8);
    await page.mouse.down();
    await page.mouse.move(grip.x + 48, grip.y + 28, { steps: 4 });
    await page.mouse.up();
    await expect(calendar).toHaveCSS("width", "600px");
    await expect(calendar).toHaveCSS("height", "420px");
    await calendar.getByRole("button", { name: "서랍에 넣기" }).click();
    await expect(calendar).toHaveCount(0);
    await expect(page.locator(".drawer-button .badge")).toHaveText("4");
  });

  test("working: two surfaces and the tasks popover", async ({ page }) => {
    await page.click('[data-desktop="2"]');
    await page.click('[data-rail="tasks"]');
    await step(page, 1000);
    expect(await primaryFills(page)).toBeLessThanOrEqual(1);
    expect(await shellTree(page)).toMatchSnapshot("working.json");
  });

  test("the light theme", async ({ page }) => {
    await page.evaluate(() => window.__shell.desk.store.set({ theme: "light", desktop: 2 }));
    await step(page, 1000);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await primaryFills(page)).toBeLessThanOrEqual(1);
    expect(await shellTree(page)).toMatchSnapshot("light.json");
  });
});

test("Eris drags anywhere on screen and the place is kept in the mode", async ({ page }) => {
  await openShell(page, "?persist=1");
  await page.evaluate(() => localStorage.clear());
  await openShell(page, "?persist=1");
  const eris = page.locator(".eris");
  const box = await eris.boundingBox();
  if (!box) throw new Error("no Eris");
  await page.mouse.move(box.x + 64, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 64 - 400, box.y + 60 + 300, { steps: 6 });
  await page.mouse.up();
  await step(page, 16);
  await expect(eris).toHaveCSS("left", "256px");
  await expect(eris).toHaveCSS("top", "340px");
  await expect(page.locator(".mode-chip.is-current .mode-dirty")).toBeVisible();
  await page.mouse.move(box.x + 64 - 400, box.y + 360);
  await page.mouse.down();
  await page.mouse.move(-500, 5000, { steps: 4 });
  await page.mouse.up();
  await step(page, 16);
  await expect(eris).toHaveCSS("left", "0px");
  await expect(eris).toHaveCSS("top", `${900 - 138}px`);
  await page.waitForTimeout(50);
  await openShell(page, "?persist=1");
  await step(page, 16);
  await expect(eris).toHaveCSS("top", `${900 - 138}px`);
  await page.evaluate(() => localStorage.clear());
});
