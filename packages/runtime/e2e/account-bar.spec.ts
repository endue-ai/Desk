import { expect, test } from "@playwright/test";
import { openShell, openThemes, step } from "./shell-helpers";
import { shellTree } from "./shell-tree";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
]) {
  test(`the person's controls stay at the bottom left at ${viewport.width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await openShell(page);
    const bar = page.locator(".account-bar");
    const buttons = bar.getByRole("button");
    await expect(buttons).toHaveCount(3);
    await expect(buttons.nth(0)).toHaveAccessibleName("인박스 · 2");
    await expect(buttons.nth(1)).toHaveAccessibleName("설정 열기");
    await expect(buttons.nth(2)).toHaveAccessibleName("사용자 정보");
    const box = await bar.boundingBox();
    expect(box?.x).toBe(24);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBe(viewport.height - 24);
    const agents = await page.locator(".sidebar").boundingBox();
    expect((agents?.y ?? 0) + (agents?.height ?? 0)).toBeLessThan(box?.y ?? 0);
    const drawer = await page.locator(".drawer").boundingBox();
    expect(drawer?.x).toBeGreaterThanOrEqual((box?.x ?? 0) + (box?.width ?? 0));
    await page.click('[data-desktop="4"]');
    await expect(bar).toBeVisible();
    expect(await bar.boundingBox()).toEqual(box);
    await page.evaluate(() =>
      window.__shell.desk.runtime.commands.run("desk.profiles.switch", { id: "night" }),
    );
    await expect(bar).toBeVisible();
    expect(await bar.boundingBox()).toEqual(box);
    await step(page, 100);
    await page.screenshot({ path: info.outputPath("account-controls.png") });
  });
}

test("the inbox keeps actionable notices even when the mode hides its status rail", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  await page.evaluate(async () => {
    const { runtime, store } = window.__shell.desk;
    runtime.commands.define("test.inbox.action", {
      title: "Acknowledge",
      owner: "desk",
      run: () => store.set({ attention: [] }),
    });
    await runtime.commands.settled();
    store.set({
      attention: [
        {
          id: "notice",
          text: "Update is ready",
          action: { label: "Acknowledge", command: "test.inbox.action" },
        },
      ],
    });
  });
  await page.getByRole("button", { name: "Inbox · 1", exact: true }).click();
  const inbox = page.getByRole("dialog", { name: "Inbox", exact: true });
  await expect(inbox).toContainText("Update is ready");
  await inbox.getByRole("button", { name: "Acknowledge" }).click();
  await expect(inbox).toContainText("Nothing here");
  await expect(page.locator(".inbox-button .badge")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(inbox).toHaveCount(0);
  await page.evaluate(() =>
    window.__shell.desk.runtime.commands.run("desk.profiles.switch", { id: "night" }),
  );
  await expect(page.locator(".rail")).toBeHidden();
  await page.getByRole("button", { name: "Inbox · 0", exact: true }).click();
  await expect(inbox).toBeVisible();
  await page.mouse.click(800, 500);
  await expect(inbox).toHaveCount(0);
});

test("signed in with endue ID, the bar and the popover show the profile (ADR 0111)", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  const profile = page.getByRole("button", { name: "User information", exact: true });
  await profile.click();
  const account = page.getByRole("dialog", { name: "User information", exact: true });
  await expect(account.getByRole("button")).toHaveText(["Sign in with endue ID", "Create account"]);
  await account.getByRole("button", { name: "Create account" }).click();
  await expect(account.locator("[data-key=account-code]")).toHaveText("WDJB-MJHT");
  await expect(account).toContainText("auth.endue.ai/realms/endue/device");
  await expect(account.getByRole("button")).toHaveText(["Open browser again", "Cancel"]);
  expect(await shellTree(page, ".account-popover")).toMatchSnapshot("signing-in.json");

  await page.evaluate(() => window.__shell.bridge.fake.approveSignIn());
  await expect(account.locator(".account-identity strong")).toHaveText("Ada Lovelace");
  await expect(account.locator(".account-identity small")).toHaveText("ada@example.com");
  await expect(page.locator(".account-profile .account-avatar")).toHaveText("A");
  await expect(account.getByRole("button")).toHaveText(["Account settings", "Sign out"]);
  expect(await shellTree(page, ".account-popover")).toMatchSnapshot("signed-in.json");

  // The account's own settings on endue open in Settings, endue account (ADR 0130).
  await account.getByRole("button", { name: "Account settings" }).click();
  const settings = page.locator(".desk-settings");
  await expect(
    settings.getByRole("heading", { name: "endue account", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(account).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await profile.click();

  await page.evaluate(() =>
    window.__shell.bridge.fake.setAccount({
      state: "signed-out",
      problem: "Your endue session ended. Sign in again.",
      reason: "session-expired",
    }),
  );
  await expect(account.locator(".account-problem")).toHaveText("Please sign in again.");
  await expect(account.locator(".account-identity strong")).toHaveText("Local user");
});

test("the profile shows local user information and refreshes the saved name", async ({ page }) => {
  await openShell(page, "?lang=en");
  const profile = page.getByRole("button", { name: "User information", exact: true });
  await profile.click();
  const account = page.getByRole("dialog", { name: "User information", exact: true });
  await expect(account).toContainText("Local user");
  await expect(account).toContainText("On this device");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    window.__shell.bridge.user = { info: async () => ({ name: "Mira" }) };
  });
  await profile.click();
  await expect(account).toContainText("Mira");
  await expect(page.locator(".account-profile .account-avatar")).toHaveText("M");
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await expect(account).toHaveCount(0);
  await expect(page.locator(".desk-settings")).toBeVisible();
  await expect(page.locator(".desk-settings-launcher")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open settings", exact: true })).toBeFocused();
});

test("themes open from Settings > Appearance and return focus to the bottom-left settings control", async ({
  page,
}, info) => {
  await openShell(page, "?lang=en&themes=1");
  await expect(page.locator(".desktops .theme-button")).toHaveCount(0);
  await openThemes(page);
  const studio = page.getByRole("dialog", { name: "Themes", exact: true });
  await expect(studio).toBeVisible();
  await expect(page.locator(".desk-settings")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(studio).toHaveCount(0);
  await expect(page.locator(".account-settings-button")).toBeFocused();
  await page.locator(".account-settings-button").click();
  await expect(page.locator('[data-key="settings-themes"]')).toBeVisible();
  await page.screenshot({ path: info.outputPath("themes-in-settings.png") });
});
