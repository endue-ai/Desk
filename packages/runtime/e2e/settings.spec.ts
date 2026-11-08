import { expect, type Page, test } from "@playwright/test";

async function open(page: Page, query = "?core=1&platform=mac") {
  await page.goto(`/desk.html${query}`);
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
}
const dialog = (page: Page) => page.locator(".desk-settings");
const row = (page: Page, id: string) => dialog(page).locator(`[data-command="${id}"]`);

test.describe("core settings", () => {
  test("opens keyboard settings with Mod+/ and uses Control on other platforms", async ({
    page,
  }) => {
    await open(page, "?core=1&platform=other");
    await page.keyboard.press("Control+,");
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+/");
    await expect(dialog(page).getByRole("heading", { name: "키보드", exact: true })).toBeVisible();
    await expect(row(page, "desk.settings.open").locator("kbd")).toHaveText("Ctrl+,");
    await dialog(page).getByRole("searchbox", { name: "설정 검색" }).fill("no such setting");
    await expect(dialog(page).getByRole("heading", { name: "검색 결과가 없습니다" })).toBeVisible();
  });

  test("opens without plugins, searches categories, saves settings and restores focus", async ({
    page,
  }, info) => {
    await open(page);
    await expect(page.locator(".desk-surface")).toHaveCount(0);
    await page.getByRole("button", { name: "설정 열기", exact: true }).focus();
    await page.keyboard.press("Meta+,");
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole("heading", { name: "일반", exact: true })).toBeVisible();
    await dialog(page).getByRole("searchbox", { name: "설정 검색" }).fill("화면");
    await expect(
      dialog(page).getByRole("heading", { name: "화면 모드", exact: true, level: 1 }),
    ).toBeVisible();
    await dialog(page).getByRole("button", { name: "라이트 모드", exact: true }).click();
    await expect(page.locator("#desk")).toHaveAttribute("data-scheme", "light");
    await expect(dialog(page).getByRole("status")).toHaveText("모든 변경사항 저장됨");
    await dialog(page).getByRole("searchbox", { name: "설정 검색" }).fill("");
    await page.screenshot({ path: info.outputPath("settings-light.png") });
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "설정 열기", exact: true })).toBeFocused();
    const stored = await page.evaluate(() => window.__deskStore);
    await open(page, `?core=1&platform=mac&store=${encodeURIComponent(JSON.stringify(stored))}`);
    await expect(page.locator("#desk")).toHaveAttribute("data-scheme", "light");
  });

  test("desk.keys.quit closes the window as Escape does, from any caller", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "설정 열기", exact: true }).focus();
    await page.keyboard.press("Meta+,");
    await expect(dialog(page)).toBeVisible();
    // The CLI, an agent or Eris runs the command; no key reaches the window's own handler.
    await page.evaluate(() => window.__desk.runtime.commands.run("desk.keys.quit"));
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "설정 열기", exact: true })).toBeFocused();
  });

  test("records, confirms conflicts, clears and resets core bindings", async ({ page }, info) => {
    await open(page);
    await page.keyboard.press("Meta+,");
    await dialog(page)
      .getByRole("navigation")
      .getByRole("button", { name: "키보드", exact: true })
      .click();
    const target = row(page, "desk.settings.open");
    await target.getByRole("button", { name: /바꾸기/ }).click();
    await page.keyboard.press("Control+Alt+j");
    await expect(target.locator("kbd")).toHaveText("⌃⌥J");
    await target.getByRole("button", { name: /바꾸기/ }).click();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeVisible();
    await expect(target.locator("kbd")).toHaveText("⌃⌥J");
    await target.getByRole("button", { name: /바꾸기/ }).click();
    await page.keyboard.press("Meta+/");
    await expect(dialog(page).locator(".settings-conflict")).toBeVisible();
    await expect(target.locator("kbd")).toHaveText("⌃⌥J");
    await dialog(page).getByRole("button", { name: "단축키 옮기기", exact: true }).click();
    await expect(target.locator("kbd")).toHaveText("⌘/");
    await expect(row(page, "desk.settings.keyboard")).toContainText("없음");
    await target.getByRole("button", { name: /지우기/ }).click();
    await expect(target.locator("kbd")).toHaveCount(0);
    await dialog(page).getByRole("button", { name: "모두 기본값으로", exact: true }).click();
    await expect(target.locator("kbd")).toHaveCount(0);
    await dialog(page).getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect(target.locator("kbd")).toHaveText("⌘,");
    await expect(row(page, "desk.settings.keyboard").locator("kbd")).toHaveText("⌘/");
    await page.screenshot({ path: info.outputPath("settings-keyboard-dark.png") });
  });

  test("records a key sequence and asks before it shadows a shorter key", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Meta+,");
    await dialog(page)
      .getByRole("navigation")
      .getByRole("button", { name: "키보드", exact: true })
      .click();
    const target = row(page, "desk.settings.open");
    // A chord ends the key unless keys in force continue it; this records several in a row.
    await dialog(page)
      .getByRole("checkbox", { name: /여러 키를 차례로 기록/ })
      .check();
    await target.getByRole("button", { name: /바꾸기/ }).click();
    await page.keyboard.press("Meta+b");
    await page.keyboard.press("Meta+s");
    await expect(dialog(page).locator(".keys-note")).toHaveText("⌘B ⌘S — Enter로 저장");
    await page.keyboard.press("Enter");
    // ⌘B (desk.buffers.switch) would only wait for the next key: the screen says so first.
    const asking = dialog(page).locator(".settings-conflict");
    await expect(asking.locator(".keys-shadowed kbd")).toHaveText("⌘B");
    await expect(target.locator("kbd")).toHaveText("⌘,");
    await dialog(page).getByRole("button", { name: "단축키 옮기기", exact: true }).click();
    await expect(target.locator("kbd")).toHaveText(["⌘B", "⌘S"]);
    await expect(dialog(page).locator(".keys-conflicts")).toHaveCount(0);
  });

  test("setting controls work in a narrow window and retain keyboard focus", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 700 });
    await open(page);
    await page.getByRole("button", { name: "설정 열기", exact: true }).click();
    await dialog(page)
      .getByRole("navigation")
      .getByRole("button", { name: "알림", exact: true })
      .click();
    const dnd = dialog(page).getByRole("switch", { name: "방해금지 모드" });
    await dnd.click();
    await expect(dnd).toHaveAttribute("aria-checked", "true");
    await expect(dnd).toBeFocused();
    await dialog(page)
      .getByRole("navigation")
      .getByRole("button", { name: "손쉬운 사용", exact: true })
      .click();
    await dialog(page).getByRole("combobox", { name: "동작", exact: true }).selectOption("reduce");
    await expect(page.locator("#desk")).toHaveAttribute("data-motion", "reduce");
    expect(await dialog(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.keyboard.press("Meta+w");
    await expect(dialog(page)).toHaveCount(0);
  });

  test("bare typing and IME do not execute user shortcuts", async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const runtime = window.__desk.runtime;
      runtime.settings.set("desk.keys.bindings", [{ key: "J", command: "desk.settings.open" }]);
      const input = document.createElement("input");
      input.id = "typing";
      document.querySelector("#desk")?.append(input);
    });
    await page.locator("#typing").fill("j");
    await page.locator("#typing").press("j");
    await expect(dialog(page)).toHaveCount(0);
    await page.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: ",", metaKey: true, isComposing: true }),
      ),
    );
    await expect(dialog(page)).toHaveCount(0);
  });

  test("plugin settings are found, apply at once and come back after a restart", async ({
    page,
  }) => {
    const confirm = () =>
      page.evaluate(() => window.__desk.runtime.settings.get("desk.buffers.confirm-unsaved"));
    await open(page, "?platform=mac");
    await page.keyboard.press("Meta+,");
    await expect(dialog(page).getByRole("button", { name: "init.yaml 열기" })).toBeVisible();
    await dialog(page).getByRole("searchbox", { name: "설정 검색" }).fill("confirm unsaved");
    await expect(
      dialog(page).getByRole("heading", { name: "플러그인", exact: true, level: 1 }),
    ).toBeVisible();
    const box = dialog(page).getByRole("checkbox", { name: "Confirm unsaved" });
    await expect(box).toBeChecked();
    await box.uncheck();
    expect(await confirm()).toBe(false);
    await expect(dialog(page).getByRole("status")).toHaveText("모든 변경사항 저장됨");
    const stored = await page.evaluate(() => window.__deskStore);
    await open(page, `?platform=mac&store=${encodeURIComponent(JSON.stringify(stored))}`);
    await expect.poll(confirm).toBe(false);
    await page.keyboard.press("Meta+,");
    await dialog(page)
      .getByRole("navigation")
      .getByRole("button", { name: "플러그인", exact: true })
      .click();
    await expect(dialog(page).getByRole("checkbox", { name: "Confirm unsaved" })).not.toBeChecked();
  });
});
