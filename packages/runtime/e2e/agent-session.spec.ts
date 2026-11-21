import { expect, type Page, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 980 } });
async function open(page: Page, entry: string, options = "") {
  await page.clock.setFixedTime(new Date("2026-01-06T12:00:00Z"));
  await page.goto(`/agent-session.html?entry=${entry}${options}`);
  if (entry === "screen") {
    await page.locator("[data-local-agent]").first().click();
    return page.locator("desk-agent-session");
  }
  const id = entry === "studio" ? "endue.agents" : "endue.local-agents";
  const frame = page.frameLocator(`[data-surface="${id}"] iframe`);
  if (entry === "studio")
    await frame.getByRole("button", { name: "Chat with Writing agent" }).click();
  else {
    await frame.getByRole("tab", { name: "2 Chat" }).click();
    const history = frame.getByRole("button", { name: "Open native history" });
    const nav = frame.getByRole("button", { name: "Show sessions" });
    if (await nav.isVisible()) await nav.click();
    await history.click();
  }
  return frame.locator("desk-agent-session");
}
const select = async (host: ReturnType<Page["locator"]>, title: string) => {
  const nav = host.getByRole("button", { name: "Show sessions" });
  if (await nav.isVisible()) await nav.click();
  await host.locator("[data-session-key]").filter({ hasText: title }).first().click();
};
test("reads the same conversation from three entry points", async ({ page }, info) => {
  for (const entry of ["plugin", "screen", "studio"]) {
    const host = await open(page, entry);
    await select(host, "Review the outline");
    await expect(host.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expect(host.locator("summary").filter({ hasText: "2 tool calls" })).toBeVisible();
    if (entry === "plugin") {
      await expect(host.getByRole("complementary", { name: "Task details" })).toBeVisible();
      const filters = host.locator(".filters summary");
      await filters.click();
      await host.locator(".filters select").last().selectOption("local");
      await filters.click();
      await expect(
        host.getByRole("button", { name: "/sample/notebook", exact: true }),
      ).toBeVisible();
      await expect(
        host.getByRole("button", { name: "/other/notebook", exact: true }),
      ).toBeVisible();
      await host.locator(".transcript").evaluate((log) => {
        log.scrollTop = 0;
      });
      const path = info.outputPath("product-session.png");
      await host.screenshot({ path });
      await info.attach("Local agent workspace", { path, contentType: "image/png" });
    }
  }
});
test("previews a related session without moving the conversation", async ({ page }) => {
  const host = await open(page, "screen");
  await select(host, "Review the outline");
  const input = host.locator("textarea");
  await input.fill("First draft");
  const details = host.getByRole("complementary", { name: "Task details" });
  if (!(await details.isVisible()))
    await host.getByRole("button", { name: "Task details", exact: true }).click();
  const sibling = details.getByRole("button", { name: /Check the captions/ });
  expect(await details.getByText("Unrelated notebook").count()).toBe(0);
  await sibling.focus();
  await sibling.press("Enter");
  await expect(details.getByText("Caption preview.")).toBeVisible();
  await expect(input).toHaveValue("First draft");
  await expect(host.locator("textarea")).toHaveCount(1);
  await details.getByRole("button", { name: "Back", exact: true }).click();
  await expect(sibling).toBeFocused();
  await sibling.click();
  await details.getByRole("button", { name: "Open in conversation" }).click();
  await expect(input).toHaveValue("");
  await expect(host.getByRole("heading", { name: "Check the captions" })).toBeVisible();
  await input.fill("Second draft");
  await select(host, "Review the outline");
  await expect(input).toHaveValue("First draft");
});

test("fits the actual pane at four widths in both schemes and high contrast", async ({
  page,
}, info) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("example.invalid")) requests.push(r.url());
  });
  for (const scheme of ["light", "dark"]) {
    const host = await open(
      page,
      "screen",
      `&scheme=${scheme}&contrast=${scheme === "dark" ? "high" : "normal"}&long=1`,
    );
    await select(host, "Review the outline");
    const theme = await host.evaluate((el) => {
      const root = el.closest<HTMLElement>("[data-scheme]");
      return {
        scheme: root?.dataset.scheme,
        contrast: root?.dataset.contrast,
        motion: root?.dataset.motion,
      };
    });
    expect(theme).toEqual({
      scheme,
      contrast: scheme === "dark" ? "high" : "normal",
      motion: "reduce",
    });
    // Give the window room before changing the reader's width, so adjacent panes remain on screen.
    await page
      .locator("section.surface")
      .filter({ has: host })
      .locator(".surface-heading")
      .dblclick();
    await expect.poll(async () => (await host.boundingBox())?.width ?? 0).toBeGreaterThan(1024);
    // Set the pane's own width, independent of the large desk window that contains it.
    for (const width of [1024, 736, 640, 360]) {
      await host.evaluate((el, w) => {
        el.style.width = `${w}px`;
        el.style.maxWidth = "none";
      }, width);
      const nav = host.getByRole("navigation", { name: "Sessions" });
      const details = host.getByRole("complementary", { name: "Task details" });
      const toggle = host.getByRole("button", { name: "Task details", exact: true });
      if (width >= 720) {
        await expect(nav).toBeVisible();
        await expect(details).toBeVisible();
      } else if (width === 640) {
        await expect(nav).toBeVisible();
        await expect(details).toBeHidden();
        await toggle.click();
        await expect(nav).toBeHidden();
        await expect(details).toBeVisible();
        await details.getByRole("button", { name: "Close details" }).click();
      } else {
        await expect(nav).toBeHidden();
        await expect(details).toBeHidden();
        await toggle.click();
        await expect(details).toBeVisible();
        await expect(host.locator("textarea")).toBeHidden();
        await details.getByRole("button", { name: "Close details" }).click();
        await host.getByRole("button", { name: "Show sessions" }).click();
        await expect(nav).toBeVisible();
        await host.locator("[data-session-key]").first().press("Enter");
      }
      const fits = await host.evaluate((el) => {
        const shell = el.shadowRoot?.querySelector<HTMLElement>(".shell");
        return !!shell && shell.scrollWidth <= shell.clientWidth + 1;
      });
      expect(fits, `${width}px ${scheme}`).toBe(true);
      await expect(host.locator("textarea")).toBeVisible();
      if (width === 1024) {
        const path = info.outputPath(`workspace-${scheme}.png`);
        await host.screenshot({ path });
        await info.attach(`workspace-${scheme}`, { path, contentType: "image/png" });
      }
    }
  }
  expect(requests).toEqual([]);
});
test("holds the visible turn when older turns load and follows new output only at the bottom", async ({
  page,
}) => {
  const host = await open(page, "screen", "&long=1");
  await select(host, "Review the outline");
  const log = host.getByRole("log");
  await expect(log.locator("[data-turn]")).toHaveCount(199);
  await log.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  const anchor = log.locator("[data-turn]").first();
  const id = await anchor.getAttribute("data-turn");
  const offset = await anchor.evaluate((el) => el.getBoundingClientRect().top);
  await log.getByRole("button", { name: "Show earlier" }).click();
  await expect(log.locator("[data-turn]")).toHaveCount(263);
  const after = log.locator(`[data-turn="${id}"]`);
  expect(
    Math.abs((await after.evaluate((el) => el.getBoundingClientRect().top)) - offset),
  ).toBeLessThan(3);
  await page.getByRole("button", { name: "Append fixture reply" }).click();
  await expect(host.getByRole("button", { name: "Jump to latest" })).toBeVisible();
  await host.getByRole("button", { name: "Jump to latest" }).click();
  await expect(host.getByRole("button", { name: "Jump to latest" })).toBeHidden();
});
