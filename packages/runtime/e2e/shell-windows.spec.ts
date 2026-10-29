import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";
import { shellTree } from "./shell-tree";

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

  test("⌘D splits right and ⌥⌘D splits down; the new pane takes focus", async ({ page }) => {
    await newSurfaceWith(page, "notes");
    await page.keyboard.press("Meta+d");
    await expect(panes(page)).toHaveCount(2);
    await expect(surface(page).locator(".split-row")).toHaveCount(1);
    await expect(surface(page).locator('[data-pane="p2"]')).toHaveClass(/is-active/);
    await expect(surface(page).locator('[data-pane="p2"]')).toHaveAttribute(
      "data-view",
      "launcher",
    );
    await surface(page).locator('[data-pane="p2"] [data-view="calendar"]').click();
    await page.keyboard.press("Meta+Alt+d");
    await expect(panes(page)).toHaveCount(3);
    await expect(surface(page).locator(".split-column")).toHaveCount(1);
    await expect(surface(page).locator(".pane-head")).toHaveCount(3);
    await surface(page).locator('[data-pane="p3"] [data-view="tomorrow"]').click();
    await expect(surface(page).locator(".pane.is-active")).toHaveAttribute("data-pane", "p3");
    await page.keyboard.press("Meta+]");
    await expect(surface(page).locator(".pane.is-active")).toHaveAttribute("data-pane", "p1");
    await expect(surface(page).locator(".surface-name")).toHaveText("메모");
    await page.keyboard.press("Meta+[");
    await expect(surface(page).locator(".pane.is-active")).toHaveAttribute("data-pane", "p3");
    expect(await shellTree(page, '[data-surface="window-1"]')).toMatchSnapshot(
      "split-surface.json",
    );
  });

  test("dividers drag and take arrow keys", async ({ page }) => {
    await newSurfaceWith(page, "notes");
    await page.keyboard.press("Meta+d");
    const divider = surface(page).locator(".divider");
    await expect(divider).toHaveAttribute("aria-valuenow", "50");
    const box = await divider.boundingBox();
    if (!box) throw new Error("no divider");
    await page.mouse.move(box.x + 1, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 1 + 96, box.y + 100, { steps: 4 });
    await page.mouse.up();
    await expect(divider).toHaveAttribute("aria-valuenow", "70");
    await divider.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(divider).toHaveAttribute("aria-valuenow", "65");
    const moved = await divider.boundingBox();
    if (!moved) throw new Error("no divider");
    await page.mouse.move(moved.x + 1, moved.y + 100);
    await page.mouse.down();
    await page.mouse.move(moved.x + 600, moved.y + 100, { steps: 4 });
    await page.mouse.up();
    await expect(divider).toHaveAttribute("aria-valuenow", "85");
  });

  test("⌘W closes the focused pane, and the last pane closes the surface", async ({ page }) => {
    await newSurfaceWith(page, "notes");
    await page.keyboard.press("Meta+d");
    await page.keyboard.press("Meta+w");
    await expect(panes(page)).toHaveCount(1);
    await expect(panes(page).first()).toHaveAttribute("data-view", "notes");
    await page.keyboard.press("Meta+w");
    await expect(surface(page)).toHaveCount(0);
  });

  test("a split surface keeps its panes through the drawer", async ({ page }) => {
    await newSurfaceWith(page, "notes");
    await page.keyboard.press("Meta+d");
    await surface(page).getByRole("button", { name: "서랍에 넣기" }).click();
    await expect(surface(page)).toHaveCount(0);
    await page.click(".drawer-button");
    await page.locator('[data-item="surface-window-1"] button').click();
    await expect(panes(page)).toHaveCount(2);
  });

  test("typing in a pane is not a command, but chords still are", async ({ page }) => {
    await newSurfaceWith(page, "notes");
    const notes = surface(page).locator("textarea");
    await notes.click();
    await page.keyboard.type("d");
    await expect(panes(page)).toHaveCount(1);
    await page.keyboard.press("Meta+d");
    await expect(panes(page)).toHaveCount(2);
  });
});

test.describe("command bindings", () => {
  async function openKeys(page: Page) {
    await page.keyboard.type("shortcuts");
    await page.getByRole("option", { name: /설정 · 단축키/ }).click();
    await expect(page.locator('[data-surface="keys"]')).toBeVisible();
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
    await page.keyboard.type("split");
    await expect(frame.getByRole("option").first()).toContainText("나누기");
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
    await expect(row(page, "desk.display.new-surface").locator("kbd")).toHaveText("⇧⌘N");
    await page.keyboard.press("Meta+n");
    await expect(page.locator('[data-surface="window-1"]')).toHaveCount(0);
    await page.keyboard.press("Meta+Shift+n");
    await expect(page.locator('[data-surface="window-1"]')).toBeVisible();

    await row(page, "desk.shell.desktop-2")
      .getByRole("button", { name: /바꾸기/ })
      .click();
    await page.keyboard.press("Meta+d");
    await expect(page.locator(".keys-note")).toHaveText("표면 · 오른쪽으로 나누기 에서 옮겼습니다");
    await expect(row(page, "desk.display.split-right")).toContainText("없음");
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
    await expect(page.locator('[data-surface="keys"]')).toBeVisible();
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
    // desk.session saves 250 ms after a change.
    await page.waitForTimeout(400);
    await openShell(page, "?persist=1");
    await page.keyboard.press("Meta+Shift+n");
    await expect(page.locator('[data-surface="window-1"]')).toBeVisible();
    await page.evaluate(() => localStorage.clear());
  });
});
