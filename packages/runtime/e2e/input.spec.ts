import { expect, test } from "@playwright/test";

test("shortcuts reach the focused surface first, then the global keymap", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(async () => {
    const { runtime, commands } = window.__desk;
    await runtime.ready;
    runtime.openSurface({ id: "notes", title: "Notes", srcdoc: "<p>notes</p>" });
    runtime.shortcuts.bind("Mod+K", () => commands.push("palette.open"));
    runtime.shortcuts.bind("Mod+K", () => commands.push("notes.search"), { surface: "notes" });
  });

  await page.keyboard.press("Control+K");
  await page.evaluate(() => window.__desk.runtime.focusSurface("notes"));
  await page.keyboard.press("Control+K");
  await page.keyboard.press("Control+J");

  expect(await page.evaluate(() => window.__desk.commands)).toEqual([
    "palette.open",
    "notes.search",
  ]);
});
