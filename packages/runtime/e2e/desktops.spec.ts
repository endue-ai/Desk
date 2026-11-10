import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell, step } from "./shell-helpers";
import { shellTree } from "./shell-tree";

test.use({ viewport: DESK });

const run = (page: Page, id: string, args?: unknown) =>
  page.evaluate(([id, args]) => window.__shell.desk.runtime.commands.run(id as string, args), [
    id,
    args,
  ] as const);
const names = (page: Page) => page.locator(".desktops .desktop-number");
const desktop = (page: Page, n: number) => page.locator(`.desktops [data-desktop="${n}"]`);

/** Six desktops: the four a desk starts with, two renamed, and two new ones with names. */
async function sixNamed(page: Page) {
  await run(page, "desk.shell.desktop-rename", { desktop: 1, name: "Mail" });
  await run(page, "desk.shell.desktop-rename", { desktop: 2, name: "Plan" });
  await run(page, "desk.shell.desktop-new", { name: "Research" });
  await run(page, "desk.shell.desktop-new", { name: "Write" });
  await run(page, "desk.shell.desktop-2");
  await step(page, 16);
}

test.describe("desktops are a named, open-ended list", () => {
  test.beforeEach(async ({ page }) => {
    await openShell(page, "?lang=en");
  });

  test("a fresh desk has four desktops named 1 to 4", async ({ page }) => {
    await expect(names(page)).toHaveText(["1", "2", "3", "4"]);
    await expect(desktop(page, 1)).toHaveAttribute("aria-label", "Desktop 1 · empty (⌃1)");
  });

  test("the switcher shows six named desktops, each with its map", async ({ page }) => {
    await sixNamed(page);
    await expect(names(page)).toHaveText(["Mail", "Plan", "3", "4", "Research", "Write"]);
    await expect(desktop(page, 2)).toHaveAttribute("aria-pressed", "true");
    await expect(desktop(page, 2)).toHaveAttribute("aria-label", "Desktop 2 · Plan (⌃2)");
    await expect(page.locator(".mode-chip.is-current .mode-dirty")).toBeVisible();
    // ⌘5 and ⌘6 reach the new ones; ⌘⇧] and ⌘⇧[ go round the list.
    await page.keyboard.press("Meta+5");
    await expect(desktop(page, 5)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Meta+Shift+BracketRight");
    await expect(desktop(page, 6)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Meta+Shift+BracketRight");
    await expect(desktop(page, 1)).toHaveAttribute("aria-pressed", "true");
    await run(page, "desk.shell.desktop-2");
    expect(await shellTree(page, ".desktops")).toMatchSnapshot("switcher-six-named.json");
  });

  test("many desktops scroll in the switcher, the one in front in sight and + at the end", async ({
    page,
  }) => {
    for (let n = 5; n <= 20; n++) await run(page, "desk.shell.desktop-new");
    await expect(names(page)).toHaveCount(20);
    const switcher = page.locator(".desktops");
    const sizes = await switcher.evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(sizes[0]).toBeGreaterThan(sizes[1] ?? 0);
    await expect(desktop(page, 20)).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".desktop-add")).toBeInViewport({ ratio: 1 });
    // The "+" sticks to the end of the list: the desktop in front stays clear of it.
    const front = await desktop(page, 20).boundingBox();
    const add = await page.locator(".desktop-add").boundingBox();
    expect((front?.x ?? 0) + (front?.width ?? 0)).toBeLessThanOrEqual(add?.x ?? 0);
    await run(page, "desk.shell.desktop-1");
    await expect(desktop(page, 1)).toBeInViewport({ ratio: 1 });
    // The cap: 32 desktops; one more says so instead.
    for (let n = 21; n <= 33; n++) await run(page, "desk.shell.desktop-new");
    await expect(names(page)).toHaveCount(32);
    await expect(page.locator(".desk-status")).toContainText("at most 32 desktops");
  });

  test("a desktop's menu renames it and moves it; dragging one reorders the list", async ({
    page,
  }) => {
    await desktop(page, 3).click({ button: "right" });
    const menu = page.getByRole("menu");
    await menu.getByRole("menuitem", { name: "Rename…" }).click();
    const input = page.getByRole("dialog").getByLabel("Name");
    await expect(input).toBeFocused();
    await input.fill("Inbox");
    await page.keyboard.press("Enter");
    await expect(names(page)).toHaveText(["1", "2", "Inbox", "4"]);
    await desktop(page, 3).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move left" }).click();
    await expect(names(page)).toHaveText(["1", "Inbox", "2", "4"]);
    const from = await desktop(page, 2).boundingBox();
    const to = await desktop(page, 4).boundingBox();
    if (!from || !to) throw new Error("no desktops");
    await page.mouse.move(from.x + 10, from.y + 10);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width - 4, to.y + 10, { steps: 6 });
    await page.mouse.up();
    await expect(names(page)).toHaveText(["1", "2", "4", "Inbox"]);
  });

  test("removing a desktop asks, then moves its windows to the one before it", async ({ page }) => {
    await desktop(page, 3).click();
    await expect(page.locator('[data-surface="notes"]')).toBeVisible();
    await desktop(page, 3).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Remove desktop…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Remove the desktop “3”?");
    await dialog.getByRole("button", { name: "Move its windows to “2” and remove" }).click();
    await expect(names(page)).toHaveText(["1", "2", "4"]);
    await expect(desktop(page, 2)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-surface="notes"]')).toBeVisible();
    await expect(page.locator('[data-surface="calendar"]')).toBeVisible();
    await run(page, "desk.shell.desktop-undo");
    await expect(names(page)).toHaveText(["1", "2", "3", "4"]);
  });

  test("the overview shows every desktop side by side; a click goes there", async ({ page }) => {
    await sixNamed(page);
    await page.keyboard.press("Meta+Shift+Backslash");
    const overview = page.getByRole("dialog", { name: "Desktops" });
    await expect(overview).toBeVisible();
    await expect(overview.locator(".overview-card")).toHaveCount(6);
    await expect(overview.locator(".overview-card.is-current")).toBeFocused();
    await expect(overview.locator('[data-desktop-id="2"] .desk-map-window')).toHaveCount(2);
    expect(await shellTree(page, ".desktops-overview")).toMatchSnapshot("overview.json");
    await page.keyboard.press("ArrowRight");
    await expect(overview.locator('[data-desktop-id="3"]')).toBeFocused();
    await overview.locator('[data-desktop-id="5"]').click();
    await expect(overview).toHaveCount(0);
    await expect(desktop(page, 5)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Meta+Shift+Backslash");
    await page.keyboard.press("Escape");
    await expect(page.locator(".desktops-overview")).toHaveCount(0);
  });

  test("a window moves to another desktop by its menu, keeping its place", async ({ page }) => {
    await sixNamed(page);
    const calendar = page.locator('[data-surface="calendar"]');
    const before = await calendar.boundingBox();
    await calendar.locator(".surface-name").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to “Research”" }).click();
    await expect(calendar).toHaveCount(0);
    await expect(desktop(page, 5)).toHaveAttribute("aria-label", "Desktop 5 · Research (⌘5)");
    expect(await shellTree(page, ".desktops")).toMatchSnapshot("window-moved.json");
    await desktop(page, 5).click();
    await expect(calendar).toBeVisible();
    expect(await calendar.boundingBox()).toEqual(before);
  });

  // The window manager drags the window (desk-wm on the compositor, ADR 0153) and says it holds it
  // (`desk://compositor-held`); this page has none, so the spec holds it as desk-wm would.
  test("a window dropped on a desktop in the switcher moves there", async ({ page }) => {
    await desktop(page, 2).click();
    const tomorrow = page.locator('[data-surface="tomorrow"]');
    const before = await tomorrow.boundingBox();
    const title = await tomorrow.locator(".surface-name").boundingBox();
    const target = await desktop(page, 4).boundingBox();
    if (!before || !title || !target) throw new Error("no window or desktop");
    await page.mouse.move(title.x + 5, title.y + 5);
    await page.mouse.down();
    await page.mouse.move(title.x + 25, title.y + 5, { steps: 2 });
    const held = { x: before.x + 20, y: before.y, w: before.width, h: before.height };
    await page.evaluate((rect) => window.__shell.desk.hold("tomorrow", rect), held);
    await page.mouse.move(target.x + 10, target.y + 12, { steps: 8 });
    await expect(desktop(page, 4)).toHaveClass(/is-drop-target/);
    await page.mouse.up();
    await page.evaluate(() => window.__shell.desk.hold(null));
    await expect(tomorrow).toHaveCount(0);
    await run(page, "desk.shell.desktop-4");
    await expect(tomorrow).toBeVisible();
    expect(await tomorrow.boundingBox()).toEqual(before);
  });

  test("⌘⇧N's command moves the window in use, and Undo brings it back", async ({ page }) => {
    await desktop(page, 3).click();
    await page.locator('[data-surface="notes"] .surface-name').click();
    await run(page, "desk.shell.move-to-desktop-1");
    await expect(page.locator('[data-surface="notes"]')).toHaveCount(0);
    await run(page, "desk.shell.desktop-1");
    await expect(page.locator('[data-surface="notes"]')).toHaveClass(/is-focused/);
    await run(page, "desk.shell.desktop-undo");
    await expect(page.locator('[data-surface="notes"]')).toHaveCount(0);
    await run(page, "desk.shell.desktop-3");
    await expect(page.locator('[data-surface="notes"]')).toBeVisible();
  });
});

test("named desktops and their windows come back after a restart, and saved into the profile", async ({
  page,
}) => {
  await openShell(page, "?lang=en&persist=1");
  await page.evaluate(() => localStorage.clear());
  await openShell(page, "?lang=en&persist=1");
  await sixNamed(page);
  await run(page, "desk.shell.move-to-desktop", { window: "calendar", desktop: "6" });
  // desk.session saves 250 ms after a change.
  await page.waitForTimeout(400);
  await openShell(page, "?lang=en&persist=1");
  await expect(names(page)).toHaveText(["Mail", "Plan", "3", "4", "Research", "Write"]);
  await expect(desktop(page, 2)).toHaveAttribute("aria-pressed", "true");
  await run(page, "desk.shell.desktop-6");
  await expect(page.locator('[data-surface="calendar"]')).toBeVisible();
  // Saved into the profile, the desktops stay when the person switches away and back.
  await page.locator(".mode-chip.is-current").click();
  await page.locator('[data-key="menu-save"]').click();
  await expect(page.locator(".mode-chip.is-current .mode-dirty")).toHaveCount(0);
  await run(page, "desk.profiles.switch", { id: "review" });
  await expect(names(page)).toHaveText(["1", "2", "3", "4"]);
  await run(page, "desk.profiles.switch", { id: "morning" });
  await expect(names(page)).toHaveText(["Mail", "Plan", "3", "4", "Research", "Write"]);
  await page.evaluate(() => localStorage.clear());
});
