import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell, putAway, windowMenu } from "./shell-helpers";

test.use({ viewport: DESK });

const surface = (page: Page) => page.locator('[data-surface="window-1"]');
const panes = (page: Page) => surface(page).locator("[data-pane]");

async function newSurfaceWith(page: Page, view: string) {
  await page.keyboard.press("Meta+n");
  await expect(surface(page).locator(".launcher")).toBeVisible();
  await surface(page).locator(`.launcher [data-view="${view}"]`).click();
}

test.describe("surfaces as windows", () => {
  test.beforeEach(async ({ page }) => {
    await openShell(page);
  });

  test("⌘N opens a new surface with a launcher; a choice fills it", async ({ page }) => {
    await page.keyboard.press("Meta+n");
    await expect(surface(page)).toHaveClass(/is-focused/);
    await expect(surface(page).locator(".surface-name")).toHaveText("새 표면");
    await surface(page).locator('.launcher [data-view="calendar"]').click();
    await expect(panes(page)).toHaveCount(1);
    await expect(panes(page).first()).toHaveAttribute("data-view", "calendar");
    await expect(surface(page).locator(".surface-name")).toHaveText("캘린더");
    await expect(page.locator(".mode-chip.is-current .mode-dirty")).toBeVisible();
    await page.keyboard.press("Meta+n");
    await expect(page.locator('[data-surface="window-2"]')).toBeVisible();
  });

  test("a surface of the shell's own view takes no tab: its menu's New tab is off, and ⌘D adds none", async ({
    page,
  }) => {
    await newSurfaceWith(page, "notes");
    await expect(surface(page).getByRole("button", { name: /새 탭/ })).toHaveCount(0);
    const menu = await windowMenu(page, "window-1");
    await expect(menu.getByRole("menuitem", { name: /새 탭/ })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await page.keyboard.press("Meta+d");
    await expect(panes(page)).toHaveCount(1);
    await expect(surface(page).locator(".tab-strip")).toBeHidden();
    await expect(panes(page).first()).toHaveAttribute("data-view", "notes");
  });

  test("a window's menu opens from its tool, runs a row by keyboard and gives the focus back", async ({
    page,
  }) => {
    await newSurfaceWith(page, "notes");
    // Three tools at most (ADR 0255): one of the desk's own views has no Pop out.
    const tools = surface(page).locator(".surface-tools button:visible");
    await expect(tools).toHaveCount(2);
    const tool = surface(page).locator('.surface-tools [aria-haspopup="menu"]');
    await expect(tool).toHaveAttribute("aria-label", "창 메뉴");
    await expect(tools.last()).toHaveAttribute("title", "닫기");
    // Enter on the tool opens the menu under it, its first row that runs in use.
    await tool.focus();
    await page.keyboard.press("Enter");
    const menu = page.locator(".desktops-menu");
    await expect(menu).toBeVisible();
    await expect(tool).toHaveAttribute("aria-expanded", "true");
    const [box, under] = [await tool.boundingBox(), await menu.boundingBox()];
    expect(under && box && under.y).toBeGreaterThanOrEqual((box?.y ?? 0) + (box?.height ?? 0));
    await expect(menu.getByRole("menuitem", { name: "최대화 또는 복원" })).toBeFocused();
    // Down to Pin, which Enter runs: the menu goes and the bar shows the pin's mark.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const pin = menu.getByRole("menuitemcheckbox", { name: "고정" });
    await expect(pin).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(surface(page)).toHaveClass(/is-pinned/);
    await expect(surface(page).locator('.surface-mark[data-mark="pinned"]')).toBeVisible();
    // Open again: Pin is checked; Escape closes it and the focus is the tool's again.
    await tool.focus();
    await page.keyboard.press("Enter");
    await expect(pin).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(tool).toBeFocused();
    await expect(tool).toHaveAttribute("aria-expanded", "false");
  });

  test("⌘W closes the surface", async ({ page }) => {
    await newSurfaceWith(page, "notes");
    await page.keyboard.press("Meta+w");
    await expect(surface(page)).toHaveCount(0);
  });

  test("a surface keeps what it shows through the drawer", async ({ page }) => {
    await newSurfaceWith(page, "notes");
    await putAway(page, "window-1");
    await expect(surface(page)).toHaveCount(0);
    await page.click(".drawer-button");
    await page.locator('[data-item="surface-window-1"] button').click();
    await expect(panes(page)).toHaveCount(1);
    await expect(panes(page).first()).toHaveAttribute("data-view", "notes");
  });

  test("typing in a surface is not a command, but chords still are", async ({ page }) => {
    await newSurfaceWith(page, "notes");
    const notes = surface(page).locator("textarea.notes-input");
    await notes.click();
    await page.keyboard.type("n");
    await expect(page.locator('[data-surface="window-2"]')).toHaveCount(0);
    await page.keyboard.press("Meta+n");
    await expect(page.locator('[data-surface="window-2"]')).toBeVisible();
  });
});

test.describe("command bindings", () => {
  async function openKeys(page: Page) {
    await page.evaluate(() => window.__shell.desk.runtime.commands.run("desk.shell.open-keys"));
    await expect(page.locator(".desk-settings")).toBeVisible();
  }
  const row = (page: Page, command: string) => page.locator(`.key-row[data-command="${command}"]`);

  test("the palette shows each command's key", async ({ page }) => {
    await openShell(page);
    await page.keyboard.type("surface");
    const option = page.getByRole("option", { name: /표면 · 새 표면/ });
    await expect(option.locator("kbd")).toHaveText("⌘N");
  });

  test("⌘K opens the desk's palette over the shell, with the shell's commands", async ({
    page,
  }) => {
    await openShell(page);
    const palette = page.locator('[data-surface="desk.palette"]');
    await expect
      .poll(() =>
        page.evaluate(() => window.__shell.desk.runtime.commands.has("desk.palette.open")),
      )
      .toBe(true);
    await page.keyboard.press("Meta+k");
    await expect(palette).toBeVisible();
    const frame = page.frameLocator('[data-surface="desk.palette"] iframe');
    await expect(frame.getByTestId("query")).toBeFocused();
    await page.keyboard.type("new tab");
    await expect(frame.getByRole("option").first()).toContainText("새 탭");
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });

  test("record a new key, use it, and a taken key moves", async ({ page }) => {
    await openShell(page);
    await openKeys(page);
    await expect(row(page, "desk.display.new-surface").locator("kbd")).toHaveText("⌘N");
    await row(page, "desk.display.new-surface")
      .getByRole("button", { name: /바꾸기/ })
      .click();
    await expect(
      row(page, "desk.display.new-surface").getByRole("button", { pressed: true }),
    ).toHaveText("키를 누르세요 · Esc 취소");
    await page.keyboard.press("Meta+Shift+n");
    await page.getByRole("button", { name: "단축키 옮기기", exact: true }).click();
    await expect(row(page, "desk.display.new-surface").locator("kbd")).toHaveText("⇧⌘N");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+n");
    await expect(page.locator('[data-surface="window-1"]')).toHaveCount(0);
    await page.keyboard.press("Meta+Shift+n");
    await expect(page.locator('[data-surface="window-1"]')).toBeVisible();

    await openKeys(page);
    await row(page, "desk.shell.desktop-2")
      .getByRole("button", { name: /바꾸기/ })
      .click();
    await page.keyboard.press("Meta+d");
    await page.getByRole("button", { name: "단축키 옮기기", exact: true }).click();
    await expect(page.locator(".keys-note")).toHaveText("단축키를 옮겼습니다.");
    await expect(row(page, "desk.display.new-tab")).toContainText("없음");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+d");
    await expect(page.locator('[data-desktop="2"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-desktop="2"]')).toHaveAttribute(
      "aria-label",
      "데스크톱 2 (⌘D)",
    );
  });

  test("Esc cancels a recording; the plugins' keys come back", async ({ page }) => {
    await openShell(page);
    await openKeys(page);
    await row(page, "desk.buffers.close")
      .getByRole("button", { name: /바꾸기/ })
      .click();
    await page.keyboard.press("Escape");
    await expect(row(page, "desk.buffers.close").locator("kbd")).toHaveText("⌘W");
    await expect(page.locator(".desk-settings")).toBeVisible();
    await row(page, "desk.buffers.close")
      .getByRole("button", { name: /바꾸기/ })
      .click();
    await page.keyboard.press("Meta+e");
    await expect(row(page, "desk.buffers.close").locator("kbd")).toHaveText("⌘E");
    await row(page, "desk.buffers.close")
      .getByRole("button", { name: /기본값/ })
      .click();
    await expect(row(page, "desk.buffers.close").locator("kbd")).toHaveText("⌘W");
    await row(page, "desk.display.new-surface")
      .getByRole("button", { name: /바꾸기/ })
      .click();
    await page.keyboard.press("Meta+j");
    await page.getByRole("button", { name: "모두 기본값으로" }).click();
    await expect(row(page, "desk.display.new-surface").locator("kbd")).toHaveText("⌘J");
    await page.getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect(row(page, "desk.display.new-surface").locator("kbd")).toHaveText("⌘N");
  });

  test("bindings are saved", async ({ page }) => {
    await openShell(page, "?persist=1");
    await page.evaluate(() => localStorage.clear());
    await openShell(page, "?persist=1");
    await openKeys(page);
    await row(page, "desk.display.new-surface")
      .getByRole("button", { name: /바꾸기/ })
      .click();
    await page.keyboard.press("Meta+Shift+n");
    await page.getByRole("button", { name: "단축키 옮기기", exact: true }).click();
    // desk.keys writes the person's bindings to ~/.desk/keys.yaml, which ?persist=1 keeps.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("desk.folder") ?? ""))
      .toContain("desk.display.new-surface");
    await openShell(page, "?persist=1");
    await page.keyboard.press("Meta+Shift+n");
    await expect(page.locator('[data-surface="window-1"]')).toBeVisible();
    await page.evaluate(() => localStorage.clear());
  });
});
