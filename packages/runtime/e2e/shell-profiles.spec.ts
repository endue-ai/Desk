import { expect, test } from "@playwright/test";
import { DESK, openShell, step } from "./shell-helpers";

// The profile switcher, top left: the canvas hint kept off its chips, a row of many profiles, and
// each profile's menu (rename, delete, restore). shell.spec.ts covers unfolding, saving and switching.
test.use({ viewport: DESK });

test.describe("the profile switcher", () => {
  test.beforeEach(async ({ page }) => {
    await openShell(page);
  });

  test("the canvas hint shows over the empty canvas, never as a chip's tooltip", async ({
    page,
  }) => {
    const chip = page.locator(".mode-chip.is-current");
    await chip.hover();
    expect(await chip.evaluate((el) => el.closest("[title]")?.getAttribute("title") ?? null)).toBe(
      null,
    );
    await page.mouse.move(700, 600);
    await expect(page.locator("#desk")).toHaveAttribute("title", "Shift + 드래그로 캔버스 이동");
    await chip.hover();
    await expect(page.locator("#desk")).not.toHaveAttribute("title", /./);
  });

  test("a row of many profiles stops before the desktops and scrolls to every one", async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const runtime = window.__shell.desk.runtime;
      const night = runtime.profiles.list().find((p) => p.id === "night");
      const names = [
        ["writing", "Writing"],
        ["weekly-review", "Weekly review"],
        ["late-night", "Late night"],
        ["reading", "Reading"],
        ["calls", "Calls"],
        ["planning", "Planning"],
        ["travel", "Travel"],
        ["scratch", "ㅎㅇㅎㅇ"],
      ];
      for (const [id, name] of names) {
        await runtime.commands.run("desk.profiles.save", {
          id,
          name,
          plugins: {},
          settings: night?.settings,
        });
      }
    });
    await page.hover(".mode-chip.is-current");
    await step(page, 400);
    const more = page.locator(".modes-more");
    const inRow = (mode: string) =>
      page.evaluate((id) => {
        const row = document.querySelector(".modes-more")?.getBoundingClientRect();
        const chip = document.querySelector(`.modes-more [data-mode="${id}"]`);
        const r = chip?.getBoundingClientRect();
        return !!row && !!r && r.left >= row.left - 0.5 && r.right <= row.right + 0.5;
      }, mode);
    const room = await page.evaluate(() => {
      const row = document.querySelector(".modes-more")?.getBoundingClientRect();
      return (
        (document.querySelector(".desktops")?.getBoundingClientRect().left ?? 0) - (row?.right ?? 0)
      );
    });
    expect(room).toBeGreaterThanOrEqual(16);
    await expect(more).toHaveAttribute("data-more", "end");
    // Default, the way home, sits last: past the room until the row scrolls.
    expect(await inRow("default")).toBe(false);
    await page.hover('.modes-more [data-mode="writing"]');
    await page.mouse.wheel(0, 2000);
    await expect(more).toHaveAttribute("data-more", "start");
    expect(await inRow("default")).toBe(true);
    await page.click('.modes-more [data-mode="default"]');
    await expect(page.locator(".mode-chip.is-current")).toHaveAttribute("data-mode", "default");
  });

  test("renames and deletes a profile of one's own from its menu", async ({ page }) => {
    const current = page.locator(".mode-chip.is-current");
    await page.click(".mode-add");
    await page.keyboard.type("Scratch");
    await page.keyboard.press("Enter");
    await expect(current).toHaveAttribute("data-mode", "scratch");
    await current.click();
    await expect(page.getByRole("menuitem")).toHaveText([
      "이 프로필에 저장",
      "새 프로필로",
      "되돌리기",
      "이름 바꾸기…",
      "프로필 지우기…",
    ]);
    await expect(page.getByRole("menuitem", { name: "새 프로필로" })).toBeFocused();
    await page.getByRole("menuitem", { name: "이름 바꾸기…" }).click();
    const rename = page.getByRole("dialog", { name: "프로필 이름 바꾸기" });
    await expect(rename.locator("input")).toHaveValue("Scratch");
    await page.keyboard.type("Late night");
    await page.keyboard.press("Enter");
    await expect(rename).toHaveCount(0);
    await expect(current.locator(".mode-name")).toHaveText("Late night");
    await expect(current).toHaveAttribute("data-mode", "scratch");
    await current.click();
    await page.getByRole("menuitem", { name: "프로필 지우기…" }).click();
    const ask = page.getByRole("dialog", { name: "“Late night” 프로필을 지울까요?" });
    await expect(ask).toContainText("Default 프로필로 바꾼 뒤 지웁니다");
    await expect(ask.getByRole("button", { name: "취소" })).toBeFocused();
    const confirm = ask.getByRole("button", { name: "지우기", exact: true });
    // Its label reads on its red (the theme editor's own rule once made it red on red).
    const [color, background] = await confirm.evaluate((el) => {
      const c = getComputedStyle(el);
      return [c.color, c.backgroundColor];
    });
    expect(color).not.toBe(background);
    await confirm.click();
    await expect(current).toHaveAttribute("data-mode", "default");
    await expect(page.locator('[data-mode="scratch"]')).toHaveCount(0);
  });

  test("right-click opens any profile's menu; a plugin's profile renamed restores", async ({
    page,
  }) => {
    const deep = page.locator('.modes-more [data-mode="deep-work"]');
    const menu = page.getByRole("menu");
    const unfold = async () => {
      await page.hover(".mode-chip.is-current");
      await step(page, 400);
    };
    await unfold();
    await deep.click({ button: "right" });
    await expect(menu.getByRole("menuitem")).toHaveText(["이름 바꾸기…"]);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(deep).toBeFocused();
    await deep.click({ button: "right" });
    await page.getByRole("menuitem", { name: "이름 바꾸기…" }).click();
    await page.keyboard.type("Deep focus");
    await page.keyboard.press("Enter");
    await expect(deep.locator(".mode-name")).toHaveText("Deep focus");
    await unfold();
    await deep.click({ button: "right" });
    await expect(menu.getByRole("menuitem")).toHaveText(["이름 바꾸기…", "처음 상태로 되돌리기…"]);
    await page.getByRole("menuitem", { name: "처음 상태로 되돌리기…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect(deep.locator(".mode-name")).toHaveText("Deep work");
  });
});
