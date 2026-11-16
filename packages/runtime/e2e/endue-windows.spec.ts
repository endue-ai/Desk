// The person's endue agents and spaces on the desk (ADR 0129): signed in, the agent bar lists them
// from studio.* with their faces (ADR 0232), each opens as a window with a card, and Studio turns an
// agent's card over to its Studio board, a space's to its status.
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
    // Each agent's face, read by the core and handed over as a data: URL (ADR 0232).
    const faces = page.locator(".sidebar [data-endue-agent] img.avatar-face");
    await expect(faces).toHaveCount(3);
    await expect(faces.first()).toHaveAttribute("src", /^data:image\//);
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
    // endue.ai's own pages, one press away, in sight with the card (ADR 0223).
    const pages = view.locator('[data-face="front"] .endue-actions [data-action^="open-"]');
    await expect(pages).toHaveText(["Agent page", "Studio page"]);
    await expect(pages.last()).toBeInViewport();
    await view.locator('[data-face="front"] [data-action="studio"]').click();
    await step(page, 600);
    await expect(view.locator(".endue-flip")).toHaveClass(/is-flipped/);
    // The back is the Studio board (ADR 0232): the ways in, the agent's sheet, what it reaches.
    const back = view.locator('[data-face="back"]');
    await expect(back.locator(".studio-name")).toHaveText("Miso");
    await expect(back.locator('[data-col="in"] [data-row]')).toHaveCount(5);
    await expect(back.locator('[data-section="model"] .studio-sheet-value')).toHaveText(
      "claude-sonnet-4.5",
    );
    // The rows the desk reads say what is there, not "see it on endue.ai" (studio.agents.facets).
    await expect(back.locator('[data-row="channel"]')).toHaveAttribute("data-state", "on");
    await expect(back.locator('[data-row="channel"] .studio-row-sub')).toHaveText("Acme");
    await expect(back.locator('[data-row="devices"] .studio-row-meta')).toHaveText("1");
    await expect(back.locator('[data-section="memory"] .studio-sheet-value')).toHaveText(
      "12 memories · 3 rules",
    );
    await expect(back.locator('[data-section="wallpaper"] .studio-sheet-value')).toHaveText(
      "Constellation · Built-in",
    );
    // Its lines are drawn from what was laid out: in a window this narrow, down a trunk at the left.
    await expect(back.locator("svg.studio-lines")).toHaveAttribute("data-layout", "stacked");
    await expect(back.locator('svg.studio-lines [data-line="console:branch"]')).toBeAttached();
    // A way in unfolds where it stands.
    await back.locator('[data-row="live"] [data-row-head]').click();
    await expect(back.locator('[data-row="live"] .studio-row-body')).toBeVisible();
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
