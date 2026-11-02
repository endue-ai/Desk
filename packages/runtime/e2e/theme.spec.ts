import { expect, test } from "@playwright/test";

// The theme engine (ADR 0056, ADR 0057): an installed theme plugin applies only when desk.theme.active
// names it, then restyles the desk and every frame live, and the endue theme comes back when cleared.
test("choosing an installed theme restyles the desk and a plugin frame without a reload", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(response.url());
  });
  await page.goto("/design-system.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  const frame = page.frameLocator('[data-surface="endue.notes"] iframe');
  const frameVar = (name: string) =>
    frame
      .locator("html")
      .evaluate((root, property) => getComputedStyle(root).getPropertyValue(property).trim(), name);
  const rootVar = (name: string) =>
    page.evaluate(
      (property) =>
        getComputedStyle(document.getElementById("desk") as HTMLElement)
          .getPropertyValue(property)
          .trim(),
      name,
    );

  // Installed, not chosen: the endue theme.
  await expect(frame.locator("body")).toHaveCSS("background-color", "rgb(30, 29, 33)");
  expect(await frameVar("--desk-radius-md")).toBe("8px");
  expect(await rootVar("--desk-backdrop")).toBe("none");
  await frame.locator("body").evaluate(() => {
    (window as Window & { stayed?: boolean }).stayed = true;
  });

  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.theme.use", { id: "test.theme" }),
  );
  await expect(frame.locator("body")).toHaveCSS("background-color", "rgb(22, 38, 58)");
  await expect.poll(() => frameVar("--desk-radius-md")).toBe("0px");
  expect(await frameVar("--desk-background")).toBe("#102030");
  expect(await frameVar("--desk-motion-fast")).toBe("100ms");
  expect(await frameVar("--desk-noise")).toBe("0.05");
  expect(await rootVar("--desk-backdrop")).toMatch(
    /^url\(".*\/plugins\/test\.theme\/images\/tiles\.png\?v=1"\)$/,
  );
  expect(await rootVar("--desk-surface-filter")).toBe("blur(10px) saturate(1.2)");
  // The same page, restyled in place.
  expect(
    await frame.locator("body").evaluate(() => (window as Window & { stayed?: boolean }).stayed),
  ).toBe(true);
  // The backdrop image the theme names is served from its plugin folder.
  const image = await page.request.get("/plugins/test.theme/images/tiles.png");
  expect(image.status()).toBe(200);

  await page.evaluate(() => window.__desk.runtime.commands.run("desk.theme.default"));
  await expect(frame.locator("body")).toHaveCSS("background-color", "rgb(30, 29, 33)");
  await expect.poll(() => frameVar("--desk-radius-md")).toBe("8px");
  expect(await rootVar("--desk-backdrop")).toBe("none");
  expect(await rootVar("--desk-surface-filter")).toBe("");
  expect(failures).toEqual([]);
});
