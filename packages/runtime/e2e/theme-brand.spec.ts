import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { paletteFrom } from "../../ui/src/theme/palette";
import { openShell, openThemes } from "./shell-helpers";

// A theme from a brand (TS-09): the studio reads a logo from disk on the device, shows its five main
// colours, and "Make a theme" opens the editor on a gated palette built from them, previewed on the
// whole desk.
const LOGO = fileURLToPath(new URL("./themes/brand/logo.png", import.meta.url));
// The fixture logo's colours by area: cream card, orange disc, navy and teal bars, a gold square.
const COLOURS = ["#f7f3e8", "#e4572e", "#1d2a44", "#2e9e8f", "#f2c14e"];

test("pick a logo, see its five colours, make a theme and tune it in the editor", async ({
  page,
}) => {
  await openShell(page, "?themes=1&lang=en");
  const rootVar = (name: string) =>
    page.evaluate(
      (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
      name,
    );
  await openThemes(page);
  const studio = page.getByRole("dialog", { name: "Themes" });
  await expect(studio).toBeVisible();

  await studio.locator('[data-key="from-image"]').click();
  const make = studio.locator('[data-key="make-theme"]');
  await expect(make).toBeDisabled();
  await studio.locator('input[type="file"][accept="image/*"]').setInputFiles(LOGO);
  const swatches = studio.locator(".theme-brand-swatch");
  await expect(swatches).toHaveCount(5);
  expect(
    await swatches.evaluateAll((els) => els.map((el) => el.getAttribute("data-color"))),
  ).toEqual(COLOURS);
  await expect(studio.locator(".theme-brand")).toContainText("#e4572e");

  await make.click();
  // The editor, on a new theme named after the file, with the palette on the whole desk.
  await expect(studio.locator('[data-key="theme-name"]')).toHaveValue("logo");
  const dark = paletteFrom(COLOURS, "dark").colors;
  await expect.poll(() => rootVar("--desk-primary")).toBe("#e4572e");
  await expect.poll(() => rootVar("--desk-background")).toBe(dark.background);
  await expect.poll(() => rootVar("--desk-text")).toBe(dark.text);
  // Gated as it was built: the editor has nothing to fix.
  await expect(studio.locator(".theme-fixes")).toContainText("Every contrast pair passes.");
  await expect(studio.locator('[data-key="color-primary-text"]')).toHaveValue("#e4572e");

  // Both schemes come from the same five colours.
  await studio.locator('[data-key="scheme-light"]').click();
  const light = paletteFrom(COLOURS, "light").colors;
  await expect.poll(() => rootVar("--desk-background")).toBe(light.background);
  await expect.poll(() => rootVar("--desk-primary")).toBe("#e4572e");

  // Back to the gallery: the preview ends, nothing was saved.
  await studio.locator('[data-key="editor-back"]').click();
  await expect.poll(() => rootVar("--desk-primary")).not.toBe("#e4572e");
});
