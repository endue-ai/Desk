import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });

/** A point on the empty canvas, and the centre of the first window in view. */
async function spots(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".has-canvas");
    const window = [...document.querySelectorAll<HTMLElement>(".surface[data-surface]")].find(
      (el) => el.getBoundingClientRect().width > 0,
    );
    if (!root || !window) return undefined;
    const w = window.getBoundingClientRect();
    for (let y = 80; y < innerHeight - 80; y += 20)
      for (let x = 80; x < innerWidth - 80; x += 20) {
        const hit = document.elementFromPoint(x, y);
        if (hit === root || hit?.classList.contains("shell-glow"))
          return { empty: { x, y }, window: { x: w.x + w.width / 2, y: w.y + w.height / 2 } };
      }
    return undefined;
  });
}

async function sweep(
  page: Page,
  mod: "Meta" | "Control",
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.keyboard.down(mod);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up(mod);
}

test.describe("Sweeping an area of the canvas (ADR 0296)", () => {
  for (const [platform, modifier] of [
    ["mac", "Meta"],
    ["other", "Control"],
  ] as const) {
    test(`${platform}: ${modifier}+drag selects windows and Ask Eris receives them`, async ({
      page,
    }) => {
      await openShell(page, `?lang=en&platform=${platform}`);
      // The fixture's third desktop holds a window (notes).
      await page.evaluate(() => window.__shell.desk.runtime.commands.run("desk.shell.desktop-3"));
      await expect(page.locator('[data-surface="notes"]')).toBeVisible();
      const at = await spots(page);
      expect(at, "an empty spot on the canvas next to a window").toBeDefined();
      if (!at) return;
      await sweep(page, modifier, at.empty, at.window);
      await expect(page.locator(".sweep-ring")).toHaveCount(1);
      const bar = page.getByRole("toolbar", { name: "Sweep" });
      await expect(bar).toContainText("1 selected");
      await bar.getByRole("button", { name: "Ask Eris" }).click();
      await expect(bar).toContainText("For Eris: 1 window");
      await bar.getByRole("button", { name: "Clear the selection" }).click();
      await expect(page.locator(".sweep-ring")).toHaveCount(0);
    });
  }

  test("the mode is a command, and the bar shows it while sweeping", async ({ page }) => {
    await openShell(page, "?lang=en");
    await page.evaluate(() =>
      window.__shell.desk.runtime.commands.run("desk.sweep.mode", { mode: "arrange" }),
    );
    const mode = await page.evaluate(() => window.__shell.desk.store.get().sweep.mode);
    expect(mode).toBe("arrange");
    await expect(
      page.evaluate(() =>
        window.__shell.desk.runtime.commands.run("desk.sweep.mode", { mode: "fly" }),
      ),
    ).rejects.toThrow("A sweep mode is one of pan, arrange, ask, select.");
  });
});
