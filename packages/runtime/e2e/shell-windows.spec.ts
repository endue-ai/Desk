import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell, putAway } from "./shell-helpers";

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

  test("a surface of the shell's own view takes no tab: no tool for one, and ⌘D adds none", async ({
    page,
  }) => {
    await newSurfaceWith(page, "notes");
    await expect(surface(page).getByRole("button", { name: /새 탭/ })).toBeHidden();
    await page.keyboard.press("Meta+d");
    await expect(panes(page)).toHaveCount(1);
    await expect(surface(page).locator(".tab-strip")).toBeHidden();
    await expect(panes(page).first()).toHaveAttribute("data-view", "notes");
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
