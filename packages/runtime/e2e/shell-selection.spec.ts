import { expect, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });

for (const finish of ["drop", "Escape"] as const) {
  test(`dragging a title never selects the desk; text remains selectable after ${finish}`, async ({
    page,
  }) => {
    await openShell(page, "?lang=en");
    await page.keyboard.press("Meta+n");
    const surface = page.locator('[data-surface="window-1"]');
    await surface.locator('[data-view="notes"]').click();
    const notes = surface.locator("textarea");
    await notes.fill("Ordinary note text remains selectable after moving a window.");
    const title = await surface.locator(".surface-name").boundingBox();
    if (!title) throw new Error("no title");
    const x = title.x + 5;
    const y = title.y + title.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // Even before the 8px drag threshold, pressing the title must not start native selection.
    await page.mouse.move(x + 4, y + 2);
    expect(await page.evaluate(() => document.getSelection()?.toString())).toBe("");
    await page.mouse.move(x + 160, y + 100, { steps: 10 });
    await expect(page.locator("html")).toHaveClass(/is-grabbing/);
    expect(await page.evaluate(() => document.getSelection()?.toString())).toBe("");
    await expect(notes).toHaveCSS("-webkit-user-select", "none");
    if (finish === "Escape") await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator("html")).not.toHaveClass(/is-grabbing/);
    expect(await page.evaluate(() => document.getSelection()?.toString())).toBe("");
    // Selection is suppressed only during the move. Use the actual mouse to select note text.
    const text = await notes.boundingBox();
    if (!text) throw new Error("no note");
    await page.mouse.move(text.x + 14, text.y + 20);
    await page.mouse.down();
    await page.mouse.move(text.x + 180, text.y + 20, { steps: 8 });
    await page.mouse.up();
    expect(
      await notes.evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart),
    ).toBeGreaterThan(0);
    // A title bar's controls still respond to clicks.
    await surface.getByRole("button", { name: "Put in drawer" }).click();
    await expect(surface).toHaveCount(0);
  });
}
