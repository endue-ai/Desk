// The account bar (#293, design #291): the launcher and the person's avatar at the bottom left.
// The inbox and Settings are the first rows of the avatar's menu, over the person's profile.
import { expect, type Page, test } from "@playwright/test";
import { openShell, openThemes, step } from "./shell-helpers";
import { shellTree } from "./shell-tree";

/** The avatar's dot, its own ::after: whether it is drawn, and whether in the primary colour. */
const dot = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--desk-primary)";
    document.body.append(probe);
    const primary = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const avatar = document.querySelector("#desk .account-profile");
    if (!avatar) throw new Error("no avatar");
    const after = getComputedStyle(avatar, "::after");
    return { drawn: after.content !== "none", primary: after.backgroundColor === primary };
  });

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
    // The launcher's button first (ADR 0217): the one place on screen that opens a plugin. Then
    // the person, whose name says what the inbox holds; nothing else.
    await expect(buttons).toHaveCount(2);
    await expect(buttons.nth(0)).toHaveAccessibleName("플러그인 열기");
    await expect(buttons.nth(1)).toHaveAccessibleName("사용자 정보 · 인박스 · 2");
    // 16 from the app's left and bottom edges, as every floating bar is from its edge (#292), and
    // as high as its two buttons: 36 and 36, 4 between, 8 above and below.
    const box = await bar.boundingBox();
    expect(box?.x).toBe(16);
    expect(box?.height).toBe(92);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBe(viewport.height - 16);
    const agents = await page.locator(".sidebar").boundingBox();
    expect((agents?.y ?? 0) + (agents?.height ?? 0)).toBeLessThan(box?.y ?? 0);
    // Nothing but the account bar lies in the app's bottom-left quarter (#296): the Drawer and the
    // origin button are the strip's under the canvas map.
    const quarter = await page.evaluate(() =>
      [
        ".modes",
        ".desktops",
        ".sidebar",
        ".account-bar",
        ".rail",
        ".eris",
        ".map-strip",
        ".drawer",
        ".canvas-reset",
        ".composer",
        ".running",
      ].filter((sel) =>
        [...document.querySelectorAll(`#desk ${sel}`)].some((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right <= innerWidth / 2 && r.top >= innerHeight / 2;
        }),
      ),
    );
    expect(quarter).toEqual([".account-bar"]);
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
  // While the inbox holds something the avatar shows a dot, in the primary colour, and says so.
  const avatar = page.locator(".account-profile");
  await expect(avatar).toHaveAccessibleName("User information · Inbox · 1");
  expect(await dot(page)).toEqual({ drawn: true, primary: true });
  // Two presses from rest: the avatar, then its menu's Inbox row.
  await avatar.click();
  await page.getByRole("menuitem", { name: "Inbox · 1", exact: true }).click();
  const inbox = page.getByRole("dialog", { name: "Inbox", exact: true });
  await expect(inbox).toContainText("Update is ready");
  await expect(avatar).toHaveAttribute("aria-expanded", "true");
  await inbox.getByRole("button", { name: "Acknowledge" }).click();
  await expect(inbox).toContainText("Nothing here");
  await expect(avatar).toHaveAccessibleName("User information");
  expect((await dot(page)).drawn).toBe(false);
  await expect(page.locator(".account-bar .badge")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(inbox).toHaveCount(0);
  await page.evaluate(() =>
    window.__shell.desk.runtime.commands.run("desk.profiles.switch", { id: "night" }),
  );
  await expect(page.locator(".rail")).toBeHidden();
  await avatar.click();
  await page.getByRole("menuitem", { name: "Inbox · 0", exact: true }).click();
  await expect(inbox).toBeVisible();
  await page.mouse.click(800, 500);
  await expect(inbox).toHaveCount(0);
});

test("signed in with endue ID, the bar and the popover show the profile (ADR 0111)", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  // The sample desk's inbox holds two things: the avatar's name says so.
  const profile = page.locator(".account-profile");
  await expect(profile).toHaveAccessibleName("User information · Inbox · 2");
  await profile.click();
  const account = page.getByRole("dialog", { name: "User information", exact: true });
  await expect(account.getByRole("menuitem")).toHaveCount(2);
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
  const profile = page.locator(".account-profile");
  await profile.click();
  const account = page.getByRole("dialog", { name: "User information", exact: true });
  await expect(account).toContainText("Local user");
  await expect(account).toContainText("On this device");
  // Escape closes the menu and gives the focus back to the avatar.
  await page.keyboard.press("Escape");
  await expect(account).toHaveCount(0);
  await expect(profile).toBeFocused();
  await page.evaluate(() => {
    window.__shell.bridge.user = { info: async () => ({ name: "Mira" }) };
  });
  await profile.click();
  await expect(account).toContainText("Mira");
  await expect(page.locator(".account-profile .account-avatar")).toHaveText("M");
  // Settings is a row of the avatar's menu; closed, it leaves the focus on the avatar.
  await account.getByRole("menuitem", { name: "Open settings", exact: true }).click();
  await expect(account).toHaveCount(0);
  await expect(page.locator(".desk-settings")).toBeVisible();
  await expect(page.locator(".desk-settings-launcher")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator(".desk-settings")).toHaveCount(0);
  await expect(profile).toBeFocused();
});

test("themes open from Settings > Appearance and return focus to the bottom-left avatar", async ({
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
  const avatar = page.locator(".account-profile");
  await expect(avatar).toBeFocused();
  await avatar.click();
  await page.getByRole("menuitem", { name: "Open settings", exact: true }).click();
  await expect(page.locator('[data-key="settings-themes"]')).toBeVisible();
  await page.screenshot({ path: info.outputPath("themes-in-settings.png") });
});
