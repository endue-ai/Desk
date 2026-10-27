import { expect, test } from "@playwright/test";

test("the state command switches Eris between her six poses", async ({ page }) => {
  await page.goto("/onboarding.html?plugins=eris");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  const frame = page.frameLocator('[data-surface="endue.eris"] iframe');
  await expect(frame.locator("#pose")).toHaveAttribute("data-state", "idle");
  for (const state of ["listening", "thinking", "done", "heads-up", "oops", "idle"]) {
    await page.evaluate(
      (s) => window.__desk.runtime.plugins?.command("endue.eris", "state", s),
      state,
    );
    await expect(frame.locator("#pose")).toHaveAttribute("data-state", state);
    await expect(frame.locator("#pose img")).toHaveAttribute("src", `./assets/state-${state}.svg`);
  }
});
