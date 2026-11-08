// The terminal's window fills its pane at every size (#538): the compositor's grid cell for a surface
// never reaches a section a shell window holds. Before the fix a stale cell (a layout an earlier desk
// saved, a session restore, a move) dropped the section into the pane's implicit grid tracks, drawn
// from a third of the way across and clipped. The fixture's terminal is the counter's page under the
// terminal's id (shell.html?apps=1), so this measures the runtime; plugins/terminal/tests cover the
// terminal's own fit and the PTY size.
import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });

const ID = "endue.terminal";
const window_ = (page: Page) => page.locator(`section.surface[data-surface="${ID}"]`);
const pane = (page: Page) => window_(page).locator(".plugin-pane");
const inner = (page: Page) => page.locator(`.desk-surface[data-surface="${ID}"]`);

type Box = { x: number; y: number; width: number; height: number };

/** The section's and the frame's boxes in the pane's coordinates, rounded to whole pixels. */
async function geometry(page: Page) {
  const [p, s, f] = await Promise.all([
    pane(page).boundingBox(),
    inner(page).boundingBox(),
    inner(page).locator("iframe").boundingBox(),
  ]);
  if (!p || !s || !f) throw new Error("no pane, section or frame");
  const relative = (b: Box) => ({
    x: Math.round(b.x - p.x),
    y: Math.round(b.y - p.y),
    width: Math.round(b.width),
    height: Math.round(b.height),
  });
  return {
    pane: { width: Math.round(p.width), height: Math.round(p.height) },
    section: relative(s),
    frame: relative(f),
  };
}

/** The section and its frame cover the pane exactly. */
async function expectFilled(page: Page, label: string) {
  const g = await geometry(page);
  const whole = { x: 0, y: 0, ...g.pane };
  expect(g.section, `${label}: the section`).toEqual(whole);
  expect(g.frame, `${label}: the frame`).toEqual(whole);
  return g;
}

/** Give the terminal a grid cell, as a layout from before the window host would. */
const staleCell = (page: Page, col: number, row: number) =>
  page.evaluate(
    ([id, c, r]) =>
      window.__shell.desk.runtime.moveSurface(id as string, {
        col: c as number,
        row: r as number,
        colSpan: 1,
        rowSpan: 1,
      }),
    [ID, col, row] as const,
  );

async function dragBy(page: Page, from: Box, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

test("a terminal window fills its pane at every size, whatever grid cell the layout kept for it", async ({
  page,
}) => {
  await openShell(page, "?apps=1&lang=en");
  await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
  await expect(window_(page)).toBeVisible();
  await expect(inner(page)).toBeVisible();
  await staleCell(page, 2, 2);
  const sizes: Record<string, Awaited<ReturnType<typeof geometry>>> = {};
  sizes.open = await expectFilled(page, "open");

  // Smaller, from the resize grip.
  const grip = await window_(page).locator('[data-resize="se"]').boundingBox();
  if (!grip) throw new Error("no grip");
  await dragBy(page, { ...grip, x: grip.x + 8, y: grip.y + 8 }, -80, -60);
  await staleCell(page, 3, 1);
  sizes.resized = await expectFilled(page, "resized");

  // Snapped to the left half: the pointer ends 10 px inside the app's left edge.
  const title = await window_(page).locator(".surface-title").boundingBox();
  if (!title) throw new Error("no title bar");
  await dragBy(page, { ...title, x: title.x + 120, y: title.y + 20 }, -(title.x + 110), 0);
  await expect(window_(page)).toHaveCSS("left", "0px");
  sizes.half = await expectFilled(page, "left half");

  // Maximized, and back.
  await window_(page).locator(".surface-title").dblclick();
  await expect(window_(page)).toHaveCSS("width", "1440px");
  await staleCell(page, 2, 1);
  sizes.maximized = await expectFilled(page, "maximized");
  await window_(page).locator(".surface-name").dblclick();
  sizes.restored = await expectFilled(page, "restored");

  // Put away and raised again: the frame comes back into the same pane.
  await window_(page).locator('.tool[aria-label="Put in drawer"]').click();
  await expect(window_(page)).toHaveCount(0);
  await page.click(".drawer-button");
  await page.click(`[data-key="raise-surface-${ID}"]`);
  await expect(inner(page)).toBeVisible();
  sizes.raised = await expectFilled(page, "raised");

  expect(sizes.maximized.pane.width).toBeGreaterThan(sizes.open.pane.width);
  expect(sizes.resized.pane.width).toBeLessThan(sizes.open.pane.width);
  expect(`${JSON.stringify(sizes, null, 2)}\n`).toMatchSnapshot("terminal-fit.json");
});
