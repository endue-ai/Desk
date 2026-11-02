import { expect, test } from "@playwright/test";
import { openShell } from "./shell-helpers";

// The theme studio's editor (TS-03 to TS-05): a copy of a theme is tuned while the whole desk shows
// it, saved as the person's own theme (theme.save on the browser core), then exported and imported
// back as a .desk-theme file.
test("tune a copy of a theme live, save it as mine, export and import it", async ({ page }) => {
  await openShell(page, "?themes=1&lang=en");
  const rootVar = (name: string) =>
    page.evaluate(
      (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
      name,
    );
  const studio = page.getByRole("dialog", { name: "Themes" });

  await page.evaluate(() =>
    window.__shell.desk.runtime.commands.run("desk.theme.edit", { id: "test.theme" }),
  );
  await expect(studio).toBeVisible();
  const name = studio.locator('[data-key="theme-name"]');
  await expect(name).toHaveValue("Test tiles 2");
  // The draft is on the whole desk already: the copy's square corners.
  await expect.poll(() => rootVar("--desk-radius-md")).toBe("0px");

  await name.fill("My tiles");
  await name.press("Tab");
  // Sections other than the palette start folded, as a long form should.
  await studio.locator('[data-section="shape"] > summary').click();
  await studio.locator('[data-key="radius"]').selectOption("round");
  await expect.poll(() => rootVar("--desk-radius-md")).toBe("12px");
  const primary = studio.locator('[data-key="color-primary-text"]');
  await primary.fill("#33ccff");
  await primary.press("Tab");
  await expect.poll(() => rootVar("--desk-primary")).toBe("#33ccff");
  await expect(studio.locator(".theme-fixes")).toContainText("Contrast fixes");

  await studio.locator('[data-key="editor-save"]').click();
  // Back in the gallery, with the new theme applied.
  const mine = studio.getByRole("option", { name: /My tiles/ });
  await expect(mine).toBeVisible();
  await expect(mine).toContainText("Applied");
  await expect.poll(() => rootVar("--desk-radius-md")).toBe("12px");
  await expect.poll(() => rootVar("--desk-primary")).toBe("#33ccff");

  await studio.locator('[data-key="export-theme"]').click();
  await expect(studio.locator(".theme-transfer-note")).toContainText(
    "Exported: ~/Downloads/local.my-tiles.desk-theme",
  );

  const bundle = {
    format: "desk-theme/1",
    manifest: {
      id: "someone.mint",
      name: "Mint",
      version: "1.0.0",
      kind: "theme",
      theme: { dark: { colors: { background: "#0f1f1a", primary: "#5fe0b0" } } },
    },
    files: {},
  };
  await studio.locator('input[type="file"][accept*="desk-theme"]').setInputFiles({
    name: "mint.desk-theme",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bundle)),
  });
  await expect(studio.locator(".theme-transfer-note")).toContainText("Imported: local.mint");
  await expect(studio.getByRole("option", { name: /Mint/ })).toBeVisible();
  // The imported theme is previewed, not applied.
  await expect.poll(() => rootVar("--desk-background")).toBe("#0f1f1a");
  await page.keyboard.press("Escape");
  await expect.poll(() => rootVar("--desk-primary")).toBe("#33ccff");
});
