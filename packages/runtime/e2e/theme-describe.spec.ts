import { expect, type Page, test } from "@playwright/test";
import { openShell } from "./shell-helpers";

// Describe (TS-06, TS-07): a sentence goes to the brain through brain.ask, which the browser core
// answers as examples/brain-echo does; the proposal is previewed on the whole desk and Apply keeps it
// as the person's own theme, with the sentence as its origin. Eris hands a look request to the tab.
const rootVar = (page: Page, name: string) =>
  page.evaluate(
    (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    name,
  );
// brain-echo's warm paper: a light theme on a warm cream ground, set in Georgia.
const CREAM = "#f6f1e7";

test("describe a theme in a sentence, see it on the whole desk and apply it", async ({ page }) => {
  await openShell(page, "?lang=en");
  const before = await rootVar(page, "--desk-background");
  await page.getByRole("button", { name: "Themes" }).click();
  const studio = page.getByRole("dialog", { name: "Themes" });
  await studio.locator('[data-key="describe"]').click();
  await studio.locator('[data-key="describe-sentence"]').fill("warm paper with a grainy texture");
  await studio.locator('[data-key="describe-generate"]').click();

  const proposal = studio.locator(".theme-proposal");
  await expect(proposal).toContainText("Warm Paper");
  await expect(proposal.locator(".theme-fixes")).toContainText("Contrast fixes");
  await expect.poll(() => rootVar(page, "--desk-background")).toBe(CREAM);
  await expect.poll(() => rootVar(page, "--desk-font-sans")).toContain("Georgia");

  await studio.locator('[data-key="describe-apply"]').click();
  const mine = studio.getByRole("option", { name: /Warm Paper/ });
  await expect(mine).toContainText("Applied");
  const origin = await page.evaluate(
    () =>
      window.__shell.desk.runtime.themes.installed().find((t) => t.id === "local.warm-paper")?.theme
        .origin,
  );
  expect(origin).toEqual({ prompt: "warm paper with a grainy texture" });
  // Kept: closing the studio leaves it in force.
  await page.keyboard.press("Escape");
  await expect(studio).toBeHidden();
  await expect.poll(() => rootVar(page, "--desk-background")).toBe(CREAM);
  expect(before).not.toBe(CREAM);
});

test("Eris hands a look request to Describe, which runs it", async ({ page }) => {
  await openShell(page, "?lang=en");
  await page.keyboard.type("make it feel like warm paper");
  // The composer's last choice says it to Eris.
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".composer-option.is-selected")).toContainText("make it feel like");
  await page.keyboard.press("Enter");

  const studio = page.getByRole("dialog", { name: "Themes" });
  await expect(studio).toBeVisible();
  await expect(studio.locator('[data-key="describe-sentence"]')).toHaveValue(
    "make it feel like warm paper",
  );
  await expect(studio.locator(".theme-proposal")).toContainText("Warm Paper");
  await expect.poll(() => rootVar(page, "--desk-background")).toBe(CREAM);
});
