import { expect, type Page, test } from "@playwright/test";
import type { SurfacePlacement } from "../src/modes/types";
import { DESK, openShell } from "./shell-helpers";
import { shellTree } from "./shell-tree";

test.use({ viewport: DESK });

/** Three of the shell's own windows and a floating one on desktop 1, Notes focused. */
async function seed(page: Page) {
  await page.evaluate(async () => {
    const at = (
      id: string,
      x: number,
      y: number,
      w: number,
      h: number,
      more: Partial<SurfacePlacement> = {},
    ): SurfacePlacement => ({ id, plugin: "endue.shell", x, y, w, h, pinned: false, ...more });
    // The window manager's state, as desk.shell.layouts would bring it (#83).
    await window.__shell.wm.desktop(1);
    await window.__shell.wm.session({
      1: {
        surfaces: [
          at("calendar", 140, 230, 560, 400),
          at("notes", 600, 300, 380, 300),
          at("tomorrow", 1000, 220, 320, 360),
          at("window-1", 260, 420, 480, 380, {
            plugin: "endue.window",
            floating: true,
            panes: { kind: "view", id: "p1", view: "launcher" },
          }),
        ],
        eris: null,
        rail: { visible: true },
        drawer: { visible: true },
      },
    });
    await window.__shell.wm.focus("notes");
  });
}

/** Every window's box on screen, by surface id. */
const boxes = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>(".surface[data-surface]")].map((el) => {
        const r = el.getBoundingClientRect();
        return [el.dataset.surface, [r.x, r.y, r.width, r.height].map(Math.round)];
      }),
    ),
  );
const arrange = (page: Page) => page.locator('.rail [data-rail="arrange"]');
const actions = (page: Page) => page.locator('.rail-popover[data-popover="arrange"]');
const button = (page: Page, key: string) => actions(page).locator(`[data-arrange="${key}"]`);
/** Show the actions as a pointer does, and wait for them. */
async function show(page: Page) {
  await arrange(page).hover();
  await expect(actions(page)).toBeVisible();
}

test.describe("the rail's Arrange button", () => {
  test("shows its actions under the pointer, each with its key, and puts them away once it has left", async ({
    page,
  }) => {
    await openShell(page, "?lang=en");
    await seed(page);
    await expect(page.locator(".arrange-strip")).toHaveCount(0);
    await expect(arrange(page)).toHaveAttribute("aria-label", "Arrange windows");
    await expect(arrange(page)).toHaveAttribute("aria-expanded", "false");
    await show(page);
    await expect(arrange(page)).toHaveAttribute("aria-expanded", "true");
    await expect(button(page, "tile")).toHaveText("Tile windows⌥⌘G");
    await expect(button(page, "tile")).toHaveAttribute("aria-keyshortcuts", "Meta+Alt+G");
    await expect(button(page, "restore")).toHaveAttribute("aria-disabled", "true");
    expect(await shellTree(page, '.rail-popover[data-popover="arrange"]')).toMatchSnapshot(
      "actions.json",
    );
    // Across to the actions: they stay under the pointer.
    await button(page, "spread").hover();
    await page.waitForTimeout(500);
    await expect(actions(page)).toBeVisible();
    await page.mouse.move(700, 120);
    await expect(actions(page)).toHaveCount(0);
  });

  test("keeps its actions open after a press, as the rail's other buttons do, and a second press closes them", async ({
    page,
  }) => {
    await openShell(page, "?lang=en");
    await seed(page);
    await show(page);
    await arrange(page).click();
    await page.mouse.move(700, 120);
    await page.waitForTimeout(500);
    await expect(actions(page)).toBeVisible();
    await arrange(page).click();
    await expect(actions(page)).toHaveCount(0);
    // From the keyboard: Enter opens them, with no pointer near.
    await page.mouse.move(700, 120);
    await arrange(page).focus();
    await page.keyboard.press("Enter");
    await expect(actions(page)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(button(page, "tile")).toBeFocused();
  });

  test("leaves another popover of the rail open when the pointer crosses it", async ({ page }) => {
    await openShell(page, "?lang=en");
    await page.locator('.rail [data-rail="tasks"]').click();
    await arrange(page).hover();
    await page.waitForTimeout(100);
    await expect(page.locator('.rail-popover[data-popover="tasks"]')).toBeVisible();
    await expect(actions(page)).toHaveCount(0);
  });

  for (const viewport of [
    DESK,
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 1024, height: 640 },
  ]) {
    test(`shows every action inside the app at ${viewport.width}×${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openShell(page, "?lang=en");
      await seed(page);
      await show(page);
      const box = await actions(page).boundingBox();
      const rail = await page.locator(".rail").boundingBox();
      if (!box || !rail) throw new Error("no actions or no rail");
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      // Beside the rail, not over it.
      expect(box.x + box.width).toBeLessThanOrEqual(rail.x);
    });
  }
});

test.describe("arranging", () => {
  test("Tile lays the normal windows out in a grid, the floating one stays, and Restore puts them back", async ({
    page,
  }) => {
    await openShell(page, "?lang=en");
    await seed(page);
    const before = await boxes(page);
    await show(page);
    await button(page, "tile").click();
    // A choice puts the actions away.
    await expect(actions(page)).toHaveCount(0);
    await expect.poll(() => boxes(page)).not.toEqual(before);
    const tiled = await boxes(page);
    // Three columns across the free area (104 to 1336) under Eris and above the dock, 12 px apart.
    expect(tiled.calendar).toEqual([104, 190, 403, 598]);
    expect(tiled.notes).toEqual([519, 190, 402, 598]);
    expect(tiled.tomorrow).toEqual([933, 190, 403, 598]);
    expect(tiled["window-1"]).toEqual(before["window-1"]);
    expect(await shellTree(page, ".surfaces")).toMatchSnapshot("tiled.json");
    await page.mouse.move(700, 120);
    await show(page);
    await expect(button(page, "restore")).toHaveAttribute("aria-disabled", "false");
    await button(page, "restore").click();
    await expect.poll(() => boxes(page)).toEqual(before);
  });

  test("Cascade from its key: one size, a step apart, the focused window on top; the desk's undo takes it back", async ({
    page,
  }) => {
    await openShell(page, "?lang=en");
    await seed(page);
    const before = await boxes(page);
    await page.keyboard.press("Meta+Alt+c");
    await expect.poll(async () => (await boxes(page)).notes).toEqual([168, 254, 739, 389]);
    const cascaded = await boxes(page);
    expect(cascaded.calendar).toEqual([104, 190, 739, 389]);
    expect(cascaded.tomorrow).toEqual([136, 222, 739, 389]);
    const z = (id: string) =>
      page.locator(`[data-surface="${id}"]`).evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(await z("notes")).toBeGreaterThan(await z("tomorrow"));
    expect(await z("tomorrow")).toBeGreaterThan(await z("calendar"));
    expect(await shellTree(page, ".surfaces")).toMatchSnapshot("cascaded.json");
    await page.evaluate(() =>
      window.__shell.stub.call({
        id: 990,
        method: "cmd.undo",
        params: { scope: { permission: "cmd:invoke", ids: ["*"] } },
      }),
    );
    await expect.poll(() => boxes(page)).toEqual(before);
  });
});
