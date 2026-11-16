import { expect, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

// The profile switcher, top left: the canvas hint kept off its chip, a menu of many profiles, and the
// rows of the profile in force (rename, delete, restore). shell.spec.ts covers the menu's profiles,
// saving and switching.
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

  test("a menu of many profiles scrolls to every one and stays inside the app", async ({
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
        ["errands", "Errands"],
        ["guests", "Guests"],
        ["music", "Music"],
        ["taxes", "Taxes"],
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
    await page.click(".mode-chip.is-current");
    const menu = page.locator(".mode-menu");
    const inMenu = (mode: string) =>
      page.evaluate((id) => {
        const box = document.querySelector(".mode-menu")?.getBoundingClientRect();
        const row = document.querySelector(`.mode-menu [data-mode="${id}"]`);
        const r = row?.getBoundingClientRect();
        return !!box && !!r && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
      }, mode);
    // The menu stops inside the app and scrolls.
    const fits = await menu.evaluate((el) => ({
      bottom: el.getBoundingClientRect().bottom,
      height: window.innerHeight,
      scrolls: el.scrollHeight > el.clientHeight,
    }));
    expect(fits.bottom).toBeLessThanOrEqual(fits.height);
    expect(fits.scrolls).toBe(true);
    // Default, the way home, sits last among the profiles: past the menu's end until it scrolls.
    expect(await inMenu("default")).toBe(false);
    await page.hover('.mode-menu [data-mode="writing"]');
    await page.mouse.wheel(0, 2000);
    await expect.poll(() => inMenu("default")).toBe(true);
    await page.click('.mode-menu [data-mode="default"]');
    await expect(page.locator(".mode-chip.is-current")).toHaveAttribute("data-mode", "default");
  });

  test("renames and deletes a profile of one's own from its menu", async ({ page }) => {
    const current = page.locator(".mode-chip.is-current");
    await current.click();
    await page.click('.mode-menu [data-key="menu-new"]');
    await page.keyboard.type("Scratch");
    await page.keyboard.press("Enter");
    await expect(current).toHaveAttribute("data-mode", "scratch");
    await current.click();
    await expect(
      page.locator('.mode-menu [role="menuitem"]:not([data-key^="menu-switch-"])'),
    ).toHaveText(["새 프로필", "이 프로필에 저장", "되돌리기", "이름 바꾸기…", "프로필 지우기…"]);
    // The first row, the first profile to switch to, has the focus.
    await expect(page.locator('.mode-menu [role="menuitem"]').first()).toBeFocused();
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

  test("right-click opens the menu of the profile in force; a plugin's profile renamed restores", async ({
    page,
  }) => {
    const chip = page.locator(".mode-chip.is-current");
    const own = page.locator(
      '.mode-menu [role="menuitem"]:not([data-key^="menu-switch-"]):not([data-key="menu-new"])',
    );
    // Another profile is changed after switching to it: a row of the menu has no menu of its own.
    await chip.click();
    await page.click('.mode-menu [data-mode="deep-work"]');
    await expect(chip).toHaveAttribute("data-mode", "deep-work");
    await chip.click({ button: "right" });
    await expect(own).toHaveText(["이 프로필에 저장", "되돌리기", "이름 바꾸기…"]);
    await page.keyboard.press("Escape");
    await expect(page.locator(".mode-menu")).toHaveCount(0);
    await expect(chip).toBeFocused();
    await chip.click({ button: "right" });
    await page.getByRole("menuitem", { name: "이름 바꾸기…" }).click();
    await page.keyboard.type("Deep focus");
    await page.keyboard.press("Enter");
    await expect(chip.locator(".mode-name")).toHaveText("Deep focus");
    await chip.click({ button: "right" });
    await expect(own).toHaveText([
      "이 프로필에 저장",
      "되돌리기",
      "이름 바꾸기…",
      "처음 상태로 되돌리기…",
    ]);
    await page.getByRole("menuitem", { name: "처음 상태로 되돌리기…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect(chip.locator(".mode-name")).toHaveText("Deep work");
    await expect(chip).toHaveAttribute("data-mode", "deep-work");
  });
});
