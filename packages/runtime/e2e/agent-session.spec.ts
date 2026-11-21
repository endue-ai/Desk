import { expect, test } from "@playwright/test";

test("reads the same conversation from three entry points", async ({ page }) => {
  for (const entry of ["plugin", "screen", "studio"]) {
    await page.goto(`/agent-session.html?entry=${entry}`);
    const host =
      entry === "screen"
        ? page.locator("desk-agent-session")
        : page.frameLocator("iframe[data-session-frame]").locator("desk-agent-session");
    await expect(host).toBeVisible();
    await host
      .getByRole("button", { name: /Review the outline/ })
      .first()
      .click();
    await expect(host.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expect(host.locator("summary").filter({ hasText: "2 tool calls" })).toBeVisible();
  }
});
test("previews a related session without moving the conversation", async ({ page }) => {
  await page.goto("/agent-session.html?entry=screen");
  const host = page.locator("desk-agent-session");
  await host
    .getByRole("button", { name: /Review the outline/ })
    .first()
    .click();
  const input = host.locator("textarea");
  await input.fill("First draft");
  const details = host.getByRole("complementary", { name: "Task details" });
  await details.getByRole("button", { name: /Check the captions/ }).click();
  await expect(details.getByText("Caption preview.")).toBeVisible();
  await expect(input).toHaveValue("First draft");
  await expect(host.locator("textarea")).toHaveCount(1);
  await expect(details.getByText("Unrelated notebook")).toHaveCount(0);
  await details.getByRole("button", { name: "Open in conversation" }).click();
  await expect(input).toHaveValue("");
  await expect(host.getByRole("heading", { name: "Check the captions" })).toBeVisible();
});
