import { expect, test } from "@playwright/test";

const hello = '[data-surface="example.hello-ui"]';

test.beforeEach(async ({ page }) => {
  await page.goto("/edges.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
});

test("the dock shows the plugins that open on the desk as tiles", async ({ page }) => {
  const dock = page.frameLocator('[data-surface="endue.dock"] iframe');
  const tiles = dock.getByRole("toolbar", { name: "Dock" }).getByRole("button");
  await expect(tiles).toHaveText(["HHello UI", "CCounter"]);
  await expect(tiles.first()).toHaveAttribute("aria-pressed", "true");
  await expect(tiles.last()).toHaveAttribute("aria-pressed", "true");
});

test("a tile puts its plugin away and brings it back", async ({ page }) => {
  const dock = page.frameLocator('[data-surface="endue.dock"] iframe');
  const tile = dock.getByRole("button", { name: "Hello UI" });
  await tile.click();
  await expect(page.locator(hello)).toHaveCount(0);
  await expect(tile).toHaveAttribute("aria-pressed", "false");

  await tile.click();
  await expect(page.locator(hello)).toHaveCount(1);
  await expect(tile).toHaveAttribute("aria-pressed", "true");

  const calls = await page.evaluate(() =>
    window.__desk.stub.log
      .filter((entry) => entry.request.method === "plugin.setEnabled")
      .map((entry) => [entry.caller, entry.request.params]),
  );
  const scope = { permission: "plugin:manage" };
  expect(calls).toEqual([
    ["endue.dock", { plugin: "example.hello-ui", enabled: false, scope }],
    ["endue.dock", { plugin: "example.hello-ui", enabled: true, scope }],
  ]);
});

test("arrow keys move between tiles", async ({ page }) => {
  const dock = page.frameLocator('[data-surface="endue.dock"] iframe');
  const first = dock.getByRole("button", { name: "Hello UI" });
  const second = dock.getByRole("button", { name: "Counter" });
  await expect(first).toHaveAttribute("tabindex", "0");
  await expect(second).toHaveAttribute("tabindex", "-1");
  await first.focus();
  await first.press("ArrowRight");
  await expect(second).toBeFocused();
  await second.press("ArrowRight");
  await expect(first).toBeFocused();
  await first.press("End");
  await expect(second).toBeFocused();
  await second.press("Home");
  await expect(first).toBeFocused();
});

test("tiles that fit sit in the middle of the dock", async ({ page }) => {
  const dock = page.frameLocator('[data-surface="endue.dock"] iframe');
  const strip = await dock.locator("#root").boundingBox();
  const row = await dock.getByRole("toolbar", { name: "Dock" }).boundingBox();
  if (!strip || !row) throw new Error("no dock");
  const left = row.x - strip.x;
  const right = strip.x + strip.width - (row.x + row.width);
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
});

// A full desk at 1280 px (#158): 24 tiles need more room than the dock has.
const MORE = [
  "Agents",
  "Archives",
  "Calendar",
  "Chat",
  "Computer",
  "Data",
  "Database",
  "Docker",
  "Docs",
  "Explorer",
  "Git",
  "Images",
  "Local agents",
  "Mail",
  "Memory",
  "Notes",
  "Player",
  "Projects",
  "Reader",
  "Sheets",
  "Slides",
  "Web",
];

/** Whether a tile lies wholly inside the dock's strip, where a person can see and press it. */
const inside = (tile: Element) => {
  const root = tile.closest("#root")?.getBoundingClientRect();
  const rect = tile.getBoundingClientRect();
  return !!root && rect.left >= root.left && rect.right <= root.right;
};

test.describe("a dock with more tiles than room, at 1280 px", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    // Installed and off, so the desk mounts none of them; the dock lists them all.
    await page.evaluate((names) => {
      for (const name of names) {
        const id = `test.${name.toLowerCase().replace(" ", "-")}`;
        window.__deskPlugins.push({
          id,
          status: "ready",
          enabled: false,
          builtIn: false,
          revision: 1,
          manifest: {
            id,
            name,
            version: "0.1.0",
            kind: "ui",
            entry: "ui/index.html",
            surfaces: [{ id: "main", placement: "center" }],
          },
        });
      }
      window.__desk.stub.emit({
        event: "plugin.changed",
        data: { plugin: "test.agents", change: "disabled", revision: 1 },
      });
    }, MORE);
    const dock = page.frameLocator('[data-surface="endue.dock"] iframe');
    await expect(dock.locator(".tile")).toHaveCount(2 + MORE.length);
    const [content, room] = await dock
      .locator("#root")
      .evaluate((root) => [root.scrollWidth, root.clientWidth]);
    expect(content).toBeGreaterThan(room * 1.5);
  });

  test("every tile can be brought inside the strip with the keys", async ({ page }) => {
    const dock = page.frameLocator('[data-surface="endue.dock"] iframe');
    const tiles = dock.locator(".tile");
    await tiles.first().focus();
    expect(await tiles.first().evaluate(inside)).toBe(true);
    // Each tile the keys move to scrolls wholly into sight, also one that showed only in part.
    for (let i = 1; i < 2 + MORE.length; i++) {
      await page.keyboard.press("ArrowRight");
      await expect(tiles.nth(i)).toBeFocused();
      await expect.poll(() => tiles.nth(i).evaluate(inside), { message: `tile ${i}` }).toBe(true);
    }
    await page.keyboard.press("Home");
    await expect.poll(() => tiles.first().evaluate(inside)).toBe(true);
  });

  test("a vertical wheel scrolls the row, from its first tile to its last", async ({ page }) => {
    const dock = page.frameLocator('[data-surface="endue.dock"] iframe');
    const tiles = dock.locator(".tile");
    const scrolled = () => dock.locator("#root").evaluate((root) => root.scrollLeft);
    // At rest the row starts with its first tile.
    expect(await scrolled()).toBe(0);
    expect(await tiles.first().evaluate(inside)).toBe(true);

    const box = await page.locator('[data-surface="endue.dock"]').boundingBox();
    if (!box) throw new Error("no dock");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
    await expect.poll(scrolled).toBeGreaterThan(0);
    await page.mouse.wheel(0, 10_000);
    await expect.poll(() => tiles.last().evaluate(inside)).toBe(true);
    await page.mouse.wheel(0, -10_000);
    await expect.poll(scrolled).toBe(0);
    expect(await tiles.first().evaluate(inside)).toBe(true);
  });
});
