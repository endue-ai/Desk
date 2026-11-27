import { expect, type Page, test } from "@playwright/test";

test.use({ viewport: { width: 1360, height: 900 } });

async function openStudio(page: Page, gitlab = false) {
  await page.goto(gitlab ? "/git-studio.html?gitlab" : "/git-studio.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(async () => {
    await window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.git-studio" });
    await window.__desk.runtime.commands.run("endue.git-studio.open", { path: "/checkout" });
  });
  const surface = page.locator('[data-surface="endue.git-studio"]');
  await surface.evaluate((node: HTMLElement) => {
    node.style.height = "780px";
  });
  const iframe = surface.locator("iframe");
  const frame = iframe.contentFrame();
  await expect(frame.getByRole("button", { name: "Origin", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__desk.commands)).toEqual([]);
  await frame.getByRole("button", { name: "Origin", exact: true }).click();
  return { frame, iframe };
}

test("shows an origin merge stack, loads jobs on hover and sends a merge after confirmation", async ({
  page,
}) => {
  const { frame } = await openStudio(page);
  await expect(frame.getByRole("heading", { name: "GitHub Actions" })).toBeVisible();
  await expect(frame.getByRole("link", { name: "November release" })).toBeVisible();
  await expect(
    frame
      .locator("#origin-requests > ul > li > .origin-children")
      .getByRole("link", { name: "Prepare topic" }),
  ).toBeVisible();
  await expect(frame.getByRole("link", { name: "Integrate topic" })).toBeVisible();
  expect(
    await page.evaluate(() => window.__desk.commands.some((call) => call.includes("/jobs"))),
  ).toBe(false);
  await frame.getByRole("link", { name: "Desktop CI" }).hover();
  await expect(frame.getByRole("link", { name: "Compile packages" })).toBeVisible();

  await frame.getByRole("button", { name: "Manage request #1" }).click();
  await frame.getByText("Merge pull request", { exact: true }).click();
  const dialog = frame.getByRole("dialog", { name: "Merge pull request #1" });
  await expect(dialog.getByText("feature/a → feature/b")).toBeVisible();
  expect(
    await page.evaluate(() => window.__desk.commands.some((call) => call.includes("--method PUT"))),
  ).toBe(false);
  await dialog.getByLabel("Merge method").selectOption("squash");
  await dialog.getByRole("button", { name: "Merge pull request" }).click();
  await expect(frame.getByText("#1 was merged on origin.")).toBeVisible();
  await expect(frame.getByRole("link", { name: "Prepare topic" })).toHaveCount(0);
  expect(await page.evaluate(() => window.__desk.commands)).toContain(
    JSON.stringify({ sha: "a".repeat(40), merge_method: "squash" }),
  );
});

test("GitLab has keyboard job details and fits a 360 pixel high contrast frame", async ({
  page,
}) => {
  const { frame, iframe } = await openStudio(page, true);
  await iframe.evaluate((node: HTMLElement) => {
    node.style.width = "360px";
  });
  await expect(frame.getByRole("heading", { name: "Merge requests" })).toBeVisible();
  await page.evaluate(async () => {
    await window.__desk.runtime.commands.run("desk.theme.light");
    await window.__desk.runtime.commands.run("desk.theme.contrast");
    await window.__desk.runtime.commands.run("desk.theme.motion");
  });
  await expect(frame.locator("html")).toHaveAttribute("data-scheme", "light");
  await expect(frame.locator("html")).toHaveAttribute("data-contrast", "high");
  await expect(frame.locator("html")).toHaveAttribute("data-motion", "reduce");
  await frame.getByRole("button", { name: /Recent CI/ }).click();
  const jobs = frame.getByRole("button", { name: /Show jobs for Pipeline #7/ });
  await jobs.focus();
  await jobs.press("Enter");
  await expect(frame.getByRole("link", { name: "Compile packages" })).toBeVisible();
  await expect(frame.getByText("1m 12s")).toBeVisible();
  await jobs.press("Escape");
  await expect(jobs).toHaveAttribute("aria-expanded", "false");
  await expect(frame.getByRole("heading", { name: "GitLab pipelines" })).toBeVisible();
  const widths = await frame.locator(".origin-page").evaluate((node) => ({
    viewport: node.ownerDocument.documentElement.clientWidth,
    width: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  expect(widths.viewport).toBe(360);
  expect(widths.scrollWidth).toBe(widths.width);
});
