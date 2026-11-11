import { expect, test } from "@playwright/test";
import { openShell } from "./shell-helpers";

// The design system studio (ADR 0090, DS-01, DS-02): a system window of the shell beside the theme
// studio. Focus previews a design system on the whole desk, Escape puts back what was in force, Enter
// applies; the shell's kit follows the component tokens, and the theme's colours stay the theme's.
test("the design system studio previews, reverts and applies a design system over the theme", async ({
  page,
}) => {
  await openShell(page, "?designs=1&lang=en");
  const rootVar = (name: string) =>
    page.evaluate(
      (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
      name,
    );
  expect(await rootVar("--desk-button-radius")).toBe("8px");
  const primary = await rootVar("--desk-primary");

  await page.evaluate(() => window.__shell.desk.runtime.commands.run("desk.design.studio"));
  const studio = page.getByRole("dialog", { name: "Design systems" });
  await expect(studio).toBeVisible();
  const options = studio.getByRole("option");
  await expect(options).toHaveCount(4);
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await expect(options.first()).toBeFocused();

  // Arrow to Soft: the desk previews it, and the studio's own buttons turn into pills.
  const soft = studio.locator('[data-design="endue.design-soft"]');
  for (let i = 0; i < 3 && (await soft.getAttribute("aria-selected")) !== "true"; i++)
    await page.keyboard.press("ArrowRight");
  await expect(soft).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => rootVar("--desk-button-radius")).toBe("9999px");
  const radius = () =>
    studio
      .locator('[data-key="design-market"]')
      .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  await expect.poll(radius).toBe("9999px");
  expect(await rootVar("--desk-primary")).toBe(primary);

  // Escape: back to the endue design system.
  await page.keyboard.press("Escape");
  await expect(studio).toBeHidden();
  await expect.poll(() => rootVar("--desk-button-radius")).toBe("8px");

  // Enter applies and closes; desk.design.active keeps it.
  await page.evaluate(() => window.__shell.desk.runtime.commands.run("desk.design.studio"));
  await expect(studio).toBeVisible();
  for (let i = 0; i < 3 && (await soft.getAttribute("aria-selected")) !== "true"; i++)
    await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(studio).toBeHidden();
  await expect.poll(() => rootVar("--desk-button-radius")).toBe("9999px");
  const active = await page.evaluate(() =>
    window.__shell.desk.runtime.settings.get("desk.design.active", ""),
  );
  expect(active).toBe("endue.design-soft");
});

// The desk's own chips take the design system's corners as its kit does (#158, item 18): under
// Blueprint (square buttons) the profile chips, the desktop buttons and the talk pill stayed round.
test("the profile chips, the desktop buttons and the talk pill take a design system's corners", async ({
  page,
}) => {
  await openShell(page, "?designs=1&lang=en");
  const corners = () =>
    page.evaluate(() => {
      const radius = (selector: string) => {
        const el = document.querySelector(selector);
        return el ? getComputedStyle(el).borderTopLeftRadius : "missing";
      };
      return {
        chip: radius(".mode-chip"),
        desktop: radius(".desktop-button"),
        pill: radius(".talk-pill"),
      };
    });
  const use = (id: string) =>
    page.evaluate(
      (design) => window.__shell.desk.runtime.commands.run("desk.design.use", { id: design }),
      id,
    );
  const endue = await corners();
  expect([endue.chip, endue.desktop]).toEqual(["8px", "8px"]);
  // A pill: its corners at least half its 48 px height.
  expect(Number.parseFloat(endue.pill)).toBeGreaterThanOrEqual(24);

  await use("endue.design-blueprint");
  await expect.poll(corners).toEqual({ chip: "0px", desktop: "0px", pill: "0px" });

  await use("endue.design-soft");
  await expect.poll(async () => (await corners()).chip).toBe("9999px");
  expect(Number.parseFloat((await corners()).pill)).toBeGreaterThanOrEqual(24);
});
