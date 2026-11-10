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

/** What the window manager publishes (desk-wm on the compositor, ADR 0153; `fixture/wm.ts`). */
const wm = {
  resize: (page: Page, dw: number, dh: number) =>
    page.evaluate(
      ([id, dw, dh]) => {
        const el = document.querySelector<HTMLElement>(`section.surface[data-surface="${id}"]`);
        const [x, y] = [el?.offsetLeft ?? 0, el?.offsetTop ?? 0];
        const [w, h] = [(el?.offsetWidth ?? 0) + dw, (el?.offsetHeight ?? 0) + dh];
        window.__shell.wm.place(id, { x, y, w, h });
      },
      [ID, dw, dh] as const,
    ),
  fill: (page: Page, where: "left" | "full") =>
    page.evaluate(([id, where]) => window.__shell.wm.fill(id, where), [ID, where] as const),
  unfill: (page: Page) => page.evaluate((id) => window.__shell.wm.unfill(id), ID),
};

test("a terminal window fills its pane at every size", async ({ page }) => {
  await openShell(page, "?apps=1&lang=en");
  await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
  await expect(window_(page)).toBeVisible();
  await expect(inner(page)).toBeVisible();
  const sizes: Record<string, Awaited<ReturnType<typeof geometry>>> = {};
  sizes.open = await expectFilled(page, "open");

  // Smaller, as from the resize grip.
  await wm.resize(page, -80, -60);
  sizes.resized = await expectFilled(page, "resized");

  // Snapped to the left half.
  await wm.fill(page, "left");
  await expect(window_(page)).toHaveCSS("left", "0px");
  sizes.half = await expectFilled(page, "left half");

  // Maximized, and back.
  await wm.fill(page, "full");
  await expect(window_(page)).toHaveCSS("width", "1440px");
  sizes.maximized = await expectFilled(page, "maximized");
  await wm.unfill(page);
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
