import { expect, type Page, test } from "@playwright/test";
import type { SurfacePlacement } from "../src/modes/types";
import { DESK, openShell, step } from "./shell-helpers";
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
const strip = (page: Page) => page.locator(".arrange-strip");
const button = (page: Page, key: string) => page.locator(`.arrange-strip [data-arrange="${key}"]`);

test.describe("the right-edge strip", () => {
  test("labels its buttons, names each key in a tooltip and takes one Tab stop", async ({
    page,
  }) => {
    await openShell(page, "?lang=en");
    await seed(page);
    await expect(strip(page)).toHaveAttribute("role", "toolbar");
    await expect(button(page, "tile")).toHaveAttribute("aria-label", "Tile windows");
    await expect(button(page, "tile")).toHaveAttribute("aria-keyshortcuts", "Meta+Alt+G");
    await expect(button(page, "restore")).toHaveAttribute("aria-disabled", "true");
    await button(page, "tile").hover();
    await expect(page.locator(".arrange-tip")).toHaveText("Tile windows (⌥⌘G)");
    await button(page, "tile").focus();
    await page.keyboard.press("ArrowDown");
    await expect(button(page, "cascade")).toBeFocused();
    await page.keyboard.press("End");
    await expect(button(page, "restore")).toBeFocused();
    await expect(button(page, "tile")).toHaveAttribute("tabindex", "-1");
    await page.mouse.move(700, 120);
    expect(await shellTree(page, ".arrange-strip")).toMatchSnapshot("strip.json");
  });

  for (const viewport of [
    DESK,
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 1024, height: 640 },
  ]) {
    test(`meets neither the rail nor the running work at ${viewport.width}×${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openShell(page, "?lang=en");
      await page.evaluate(() => window.__shell.wm.desktop(2));
      await step(page, 100);
      const hits = await page.evaluate(() => {
        const box = (el: Element) => el.getBoundingClientRect();
        const own = box(document.querySelector(".arrange-strip") as Element);
        return [".rail", ".running > li", ".desktops", ".composer"].flatMap((sel) =>
          [...document.querySelectorAll(sel)]
            .map(box)
            .filter(
              (r) =>
                r.width > 0 &&
                own.x < r.right &&
                r.x < own.right &&
                own.y < r.bottom &&
                r.y < own.bottom,
            )
            .map(() => sel),
        );
      });
      expect(hits).toEqual([]);
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
    await button(page, "tile").click();
    await expect.poll(() => boxes(page)).not.toEqual(before);
    const tiled = await boxes(page);
    // Three columns across the free area (104 to 1336) under Eris, 12 px apart.
    expect(tiled.calendar).toEqual([104, 190, 403, 622]);
    expect(tiled.notes).toEqual([519, 190, 402, 622]);
    expect(tiled.tomorrow).toEqual([933, 190, 403, 622]);
    expect(tiled["window-1"]).toEqual(before["window-1"]);
    expect(await shellTree(page, ".surfaces")).toMatchSnapshot("tiled.json");
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
    await expect.poll(async () => (await boxes(page)).notes).toEqual([168, 254, 739, 404]);
    const cascaded = await boxes(page);
    expect(cascaded.calendar).toEqual([104, 190, 739, 404]);
    expect(cascaded.tomorrow).toEqual([136, 222, 739, 404]);
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
