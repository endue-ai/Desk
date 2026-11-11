// The real Explorer frame at the window sizes the desk first gives it (402×305, and 643×339 after a
// cascade): its right-click menu shows all nine rows without scrolling, inside the page, and the quick
// preview never hides the selected row (#160, items 14 and 20).
import { expect, type FrameLocator, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });

const ID = "endue.explorer";
const frame = (page: Page) => page.frameLocator(`.desk-surface[data-surface="${ID}"] iframe`);
const row = (page: Page, name: RegExp) => frame(page).getByRole("treeitem", { name });

/** The Explorer's window at `w`×`h`, as desk-wm places it. */
const size = (page: Page, w: number, h: number) =>
  page.evaluate(([id, w, h]) => window.__shell.wm.place(id, { x: 40, y: 80, w, h }), [
    ID,
    w,
    h,
  ] as const);

/** The menu's box and its rows' boxes, in the frame's own page. */
const menuBoxes = (explorer: FrameLocator) =>
  explorer.locator("[role=menu]").evaluate((menu) => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    return {
      page: { width: innerWidth, height: innerHeight },
      menu: box(menu),
      scrolls: menu.scrollHeight > menu.clientHeight,
      rows: [...menu.querySelectorAll("[role=menuitem]")].map(box),
    };
  });

test.beforeEach(async ({ page }) => {
  await openShell(page, "?files=1&lang=en");
  await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
  await page.evaluate(
    (id) => window.__shell.desk.runtime.commands.run("desk.plugins.open", { plugin: id }),
    ID,
  );
  await expect(row(page, /picture\.png/)).toBeVisible();
});

for (const [w, h] of [
  [402, 305],
  [643, 339],
] as const) {
  test(`at ${w}×${h} the right-click menu shows its nine rows inside the page`, async ({
    page,
  }) => {
    await size(page, w, h);
    await expect
      .poll(() =>
        frame(page)
          .locator("body")
          .evaluate(() => innerWidth),
      )
      .toBeLessThan(w);
    await row(page, /picture\.png/).click({ button: "right" });
    await expect(frame(page).locator("[role=menu]")).toBeVisible();
    const { page: inner, menu, scrolls, rows } = await menuBoxes(frame(page));
    expect(rows).toHaveLength(9);
    expect(scrolls, "the menu scrolls").toBe(false);
    expect(menu.top).toBeGreaterThanOrEqual(0);
    expect(menu.left).toBeGreaterThanOrEqual(0);
    expect(menu.bottom).toBeLessThanOrEqual(inner.height);
    expect(menu.right).toBeLessThanOrEqual(inner.width);
    for (const box of rows) {
      expect(box.top).toBeGreaterThanOrEqual(menu.top);
      expect(box.bottom).toBeLessThanOrEqual(menu.bottom);
    }
    await expect(frame(page).getByRole("menuitem", { name: "Move to Trash" })).toBeInViewport();
  });
}

test("at 402×305 the quick preview keeps the selected row in sight", async ({ page }) => {
  await size(page, 402, 305);
  await expect
    .poll(() =>
      frame(page)
        .locator("body")
        .evaluate(() => innerHeight),
    )
    .toBeLessThan(305);
  // The last row, selected by the keys (a click would also open it in Images), then previewed.
  const picture = row(page, /picture\.png/);
  await frame(page).locator("#tree").focus();
  await frame(page).locator("#tree").press("End");
  await expect(picture).toHaveAttribute("aria-selected", "true");
  await picture.press("Space");
  await expect(frame(page).locator("#preview")).toBeVisible();
  const [item, main] = await Promise.all([
    picture.evaluate((el) => el.getBoundingClientRect().toJSON()),
    frame(page)
      .locator("main")
      .evaluate((el) => el.getBoundingClientRect().toJSON()),
  ]);
  // Whole, give or take the engine's rounding of a scroll offset.
  expect(item.top).toBeGreaterThanOrEqual(main.top - 1);
  expect(item.bottom).toBeLessThanOrEqual(main.bottom + 1);
});
