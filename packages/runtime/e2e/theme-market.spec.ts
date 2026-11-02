import { expect, type Page, test } from "@playwright/test";
import { openShell } from "./shell-helpers";

// The theme studio's Market tab (TS-08, ADR 0060). The browser core reads the fixture market
// (e2e/themes/market, which the e2e server serves at /market/ and ?market=1 lists in
// desk.theme.markets as https://market.test/index.json). Its themes show as cards; Preview downloads
// one, checks its sha256 and shows it on the whole desk without installing it; Install brings it in
// through theme.import with its url and sha256; Apply puts it in force.
const rootVar = (page: Page, name: string) =>
  page.evaluate(
    (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    name,
  );
const installed = (page: Page) =>
  page.evaluate(() => window.__shell.desk.runtime.themes.installed().map((t) => t.id));
// Fern's dark background, the scheme the fixture desk starts in.
const FERN = "#0f1d17";

test("list the market, preview a theme, install it and apply it", async ({ page }) => {
  await openShell(page, "?market=1&lang=en");
  const before = await rootVar(page, "--desk-background");
  await page.getByRole("button", { name: "Themes" }).click();
  const studio = page.getByRole("dialog", { name: "Themes" });
  await studio.locator('[data-key="market"]').click();

  const cards = studio.locator(".theme-market-card");
  await expect(cards).toHaveCount(3);
  const fern = studio.locator('.theme-market-card[data-theme="market.fern"]');
  await expect(fern).toContainText("Fern");
  await expect(fern).toContainText("Team endue");
  await expect(fern).toContainText("CC0-1.0");
  await expect(fern).toContainText("Available");

  // A theme whose bytes are not the ones its index names never reaches the desk.
  const broken = studio.locator('.theme-market-card[data-theme="market.broken"]');
  await broken.locator('[data-key="market-preview"]').click();
  await expect(studio.locator(".theme-market-note")).toContainText("sha256");
  expect(await rootVar(page, "--desk-background")).toBe(before);

  await fern.locator('[data-key="market-preview"]').click();
  await expect.poll(() => rootVar(page, "--desk-background")).toBe(FERN);
  expect(await installed(page)).not.toContain("market.fern");

  await fern.locator('[data-key="market-install"]').click();
  await expect(fern).toContainText("Installed");
  await expect.poll(() => installed(page)).toContain("market.fern");

  await fern.locator('[data-key="market-apply"]').click();
  await expect(studio.getByRole("option", { name: /Fern/ })).toContainText("Applied");
  await page.keyboard.press("Escape");
  await expect(studio).toBeHidden();
  await expect.poll(() => rootVar(page, "--desk-background")).toBe(FERN);
  expect(await page.evaluate(() => window.__shell.desk.runtime.themes.active())).toBe(
    "market.fern",
  );
});
