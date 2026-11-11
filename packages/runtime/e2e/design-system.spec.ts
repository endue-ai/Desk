import { expect, test } from "@playwright/test";

test("Notes shares the design scale and follows live theme and reduced-motion changes", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/_desk/") && response.status() >= 400)
      failures.push(response.url());
  });
  await page.goto("/design-system.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  const frame = page.frameLocator('[data-surface="endue.notes"] iframe');
  await expect(frame.locator("html")).toHaveAttribute("data-scheme", "dark");
  await expect(frame.locator('link[href="/_desk/tokens.css"]')).toHaveCount(1);
  await expect(frame.locator('link[href="/_desk/base.css"]')).toHaveCount(1);
  await expect(frame.locator("body")).toHaveCSS("font-size", "14px");
  await expect(frame.locator("body")).toHaveCSS("padding-left", "12px");
  await expect(frame.locator("body")).toHaveCSS("background-color", "rgb(30, 29, 33)");
  const variable = (name: string) =>
    frame
      .locator("html")
      .evaluate((root, property) => getComputedStyle(root).getPropertyValue(property).trim(), name);
  expect(await variable("--desk-primary-text")).toBe("#b6a3f5");
  expect(await variable("--desk-motion-fast")).toBe("150ms");
  // The engine's own parts follow the theme from tokens.css (#156): the scheme of its controls, and
  // scrollbars with the theme's control colour on a clear track, never the engine's light ones.
  const native = () =>
    frame.locator("html").evaluate((root) => {
      const probe = root.ownerDocument.createElement("i");
      probe.style.color = "var(--desk-input)";
      root.append(probe);
      const thumb = getComputedStyle(probe).color;
      probe.remove();
      const style = getComputedStyle(root);
      return { scheme: style.colorScheme, bars: style.scrollbarColor, thumb };
    });
  const dark = await native();
  expect(dark).toEqual({
    scheme: "dark",
    bars: "rgb(131, 121, 145) rgba(0, 0, 0, 0)",
    thumb: "rgb(131, 121, 145)",
  });
  await page.evaluate(() => window.__desk.runtime.commands.run("desk.theme.light"));
  await expect(frame.locator("html")).toHaveAttribute("data-scheme", "light");
  await expect(frame.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect.poll(() => variable("--desk-primary-text")).toBe("#6b4f9e");
  const light = await native();
  expect(light.scheme).toBe("light");
  expect(light.bars).toBe(`${light.thumb} rgba(0, 0, 0, 0)`);
  expect(light.thumb).not.toBe(dark.thumb);
  await page.evaluate(() => window.__desk.runtime.commands.run("desk.theme.motion"));
  await expect(frame.locator("html")).toHaveAttribute("data-motion", "reduce");
  expect(await variable("--desk-motion-fast")).toBe("0ms");
  expect(failures).toEqual([]);
});
