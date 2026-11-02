import { expect, test } from "@playwright/test";
import { openShell } from "./shell-helpers";

// The theme studio (ADR 0056, TS-01, TS-02): a system window of the shell. Focus previews a theme on
// the whole desk, Escape puts back what was in force, Enter applies, and the choice comes back with
// the session.
test("the theme studio previews, reverts, applies and keeps the theme, by keyboard", async ({
  page,
}) => {
  await openShell(page, "?themes=1&persist=1&lang=en");
  const rootVar = (name: string) =>
    page.evaluate(
      (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
      name,
    );
  const backdrop = () =>
    page.locator("#desk").evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(await rootVar("--desk-radius-md")).toBe("8px");

  // The way in at the top right.
  await page.getByRole("button", { name: "Themes" }).click();
  const studio = page.getByRole("dialog", { name: "Themes" });
  await expect(studio).toBeVisible();
  const options = studio.getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await expect(options.first()).toBeFocused();
  await expect(options.nth(1)).toContainText("Test tiles");

  // Arrow: the desk previews the theme; the setting is untouched.
  await page.keyboard.press("ArrowRight");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => rootVar("--desk-radius-md")).toBe("0px");
  await expect(studio.getByRole("status")).toContainText("Previewing: Test tiles");

  // Escape: back to what was in force, and the studio closes.
  await page.keyboard.press("Escape");
  await expect(studio).toBeHidden();
  await expect.poll(() => rootVar("--desk-radius-md")).toBe("8px");
  expect(await backdrop()).toBe("none");

  // The command opens it too; Enter applies and closes.
  await page.evaluate(() => window.__shell.desk.runtime.commands.run("desk.theme.studio"));
  await expect(studio).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(studio).toBeHidden();
  await expect.poll(() => rootVar("--desk-radius-md")).toBe("0px");
  await expect.poll(backdrop).toContain("/plugins/test.theme/images/tiles.png");

  // Kept with the session: after a reload the theme is still in force.
  await page.evaluate(() => window.__shell.desk.runtime.commands.run("desk.session.save"));
  await page.reload();
  await page.waitForFunction(() => window.__shell !== undefined);
  await page.evaluate(() => window.__shell.desk.ready);
  await expect.poll(() => rootVar("--desk-radius-md")).toBe("0px");
  await expect.poll(() => rootVar("--desk-background")).toBe("#102030");
});
