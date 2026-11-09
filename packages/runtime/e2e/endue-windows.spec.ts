// The person's endue agents and spaces on the desk (ADR 0129): signed in, the agent bar lists them
// from studio.*, each opens as a window with a card, and Studio turns the card over to its status.
import { expect, test } from "@playwright/test";
import { DESK, openShell, step } from "./shell-helpers";

test.use({ viewport: DESK });

const MISO = "ag_sample0000000000000000001";
const SCOUT = "ag_sample0000000000000000003";

test.describe("endue agents and spaces as windows", () => {
  test("appear in the agent bar once the desk signs in", async ({ page }) => {
    await openShell(page, "?lang=en&endue=1");
    await expect(page.locator(".sidebar [data-endue-agent]")).toHaveCount(0);
    await expect(page.locator(".sidebar [data-agent]").first()).toBeVisible();
    await page.evaluate(() =>
      window.__shell.bridge.fake.setAccount({
        state: "signed-in",
        profile: { displayName: "Ada" },
      }),
    );
    await expect(page.locator(".sidebar [data-endue-agent]")).toHaveCount(3);
    await expect(page.locator(".sidebar [data-endue-space]")).toHaveCount(2);
    await expect(page.locator(".sidebar [data-agent]")).toHaveCount(0);
    await expect(page.locator(`.sidebar [data-endue-agent="${MISO}"]`)).toHaveAttribute(
      "data-presence",
      "working",
    );
  });

  test("an agent opens as a window whose card Studio turns over", async ({ page }) => {
    await openShell(page, "?lang=en&endue=signed-in");
    await page.click(`.sidebar [data-endue-agent="${MISO}"]`);
    const view = page.locator(`[data-endue-agent-view="${MISO}"]`);
    await expect(view.locator('[data-face="front"] .endue-title')).toHaveText("Miso");
    // The window is tall enough that Studio is in sight without scrolling.
    await expect(view.locator('[data-face="front"] [data-action="studio"]')).toBeInViewport();
    await expect(view.locator('[data-face="front"] .endue-handle')).toHaveText(
      "@miso · Keeps my calendar and sorts my mail",
    );
    await view.locator('[data-face="front"] [data-action="studio"]').click();
    await step(page, 600);
    await expect(view.locator(".endue-flip")).toHaveClass(/is-flipped/);
    await expect(view.locator('[data-face="back"] [data-fact="status"] dd')).toHaveText("Active");
    await expect(view.locator('[data-face="back"] [data-fact="model"] dd')).toHaveText(
      "claude-sonnet-4.5",
    );
    await expect(view.locator('[data-face="front"]')).toHaveAttribute("aria-hidden", "true");
    await view.locator('[data-face="back"] [data-action="card"]').click();
    await step(page, 600);
    await expect(view.locator(".endue-flip")).not.toHaveClass(/is-flipped/);
  });

  test("a space opens as a window, and its Studio opens one of its agents", async ({ page }) => {
    await openShell(page, "?lang=en&endue=signed-in");
    await page.click('.sidebar [data-endue-space="sp_sample001"]');
    const view = page.locator('[data-endue-space-view="sp_sample001"]');
    await expect(view.locator('[data-face="front"] .endue-title')).toHaveText("Launch");
    await expect(view.locator('[data-face="front"] .endue-handle')).toHaveText("Front desk · Miso");
    await view.locator('[data-face="front"] [data-action="studio"]').click();
    await step(page, 600);
    await expect(view.locator('[data-fact="rooms"] dd')).toHaveText("2 · 3 unread · 1 discussing");
    await view.locator(`[data-member="${SCOUT}"]`).click();
    await expect(page.locator(`[data-endue-agent-view="${SCOUT}"]`)).toBeVisible();
  });
});
