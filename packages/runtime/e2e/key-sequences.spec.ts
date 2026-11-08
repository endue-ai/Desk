import { expect, type Page, test } from "@playwright/test";
import { renderTree } from "../src/inspect/tree";

/** The bare desk on macOS with the person's sequences (ADR 0118). */
async function open(page: Page) {
  await page.goto("/desk.html?core=1&platform=mac");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(async () => {
    const { runtime } = window.__desk;
    await runtime.ready;
    runtime.settings.set("desk.keys.bindings", [
      { key: "Mod+K Mod+S", command: "desk.settings.open" },
      { key: "Mod+K Mod+T", command: "desk.settings.keyboard" },
      { key: "Ctrl+C p f", command: "desk.settings.keyboard" },
    ]);
  });
}

const overlay = (page: Page) => page.locator(".desk-which-key");
const pending = (page: Page) => page.locator(".desk-keys-pending");
const settings = (page: Page) => page.locator(".desk-settings");

test("after a prefix the which-key overlay lists every continuation, and the next key runs one", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("Meta+K");
  await expect(overlay(page)).toBeVisible();
  await expect(pending(page)).toContainText("⌘K");
  await expect(overlay(page).getByRole("combobox")).toBeFocused();
  await expect(overlay(page).getByRole("option")).toHaveCount(2);
  const tree = await page.evaluate(renderTree, ".desk-which-key");
  expect(`${JSON.stringify(tree, null, 2)}\n`).toMatchSnapshot("which-key-after-mod-k.json");

  await page.keyboard.press("Meta+S");
  await expect(overlay(page)).toHaveCount(0);
  await expect(pending(page)).toHaveCount(0);
  await expect(settings(page)).toBeVisible();
});

test("plain keys after a prefix, Escape to cancel, and search with Enter", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+C");
  await expect(overlay(page)).toBeVisible();
  await page.keyboard.press("p");
  await expect(overlay(page).getByRole("option")).toHaveCount(1);
  await page.keyboard.press("f");
  await expect(overlay(page)).toHaveCount(0);
  await expect(settings(page).getByRole("heading", { name: "키보드", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings(page)).toHaveCount(0);

  await page.keyboard.press("Meta+K");
  await page.keyboard.press("Escape");
  await expect(overlay(page)).toHaveCount(0);
  await expect(pending(page)).toHaveText("취소됨");
  expect(await page.evaluate(() => window.__desk.runtime.shortcuts.sequences.pending)).toEqual([]);

  // A key that continues nothing starts a search; Enter runs the one selected.
  await page.keyboard.press("Meta+K");
  await page.keyboard.type("keyboard");
  await expect(overlay(page).getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(overlay(page)).toHaveCount(0);
  await expect(settings(page).getByRole("heading", { name: "키보드", exact: true })).toBeVisible();
});
