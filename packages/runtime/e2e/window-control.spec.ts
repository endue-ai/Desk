import { expect, type Page, test } from "@playwright/test";
import type { SurfacePlacement } from "../src/modes/types";
import { DESK, openShell } from "./shell-helpers";

// Eris controls the desk's windows (ADR 0269): the window commands move and resize a window in CSS
// pixels, fill and snap it, float and pin it, and the answer, the page's box of the window and
// desk.windows.list, which Eris reads, all say the same pixels.
test.use({ viewport: DESK });

/** Two of the shell's own windows on desktop 1, Notes focused. */
async function seed(page: Page) {
  await page.evaluate(async () => {
    const at = (id: string, x: number, y: number, w: number, h: number): SurfacePlacement => ({
      id,
      plugin: "endue.shell",
      x,
      y,
      w,
      h,
      pinned: false,
    });
    await window.__shell.wm.desktop(1);
    await window.__shell.wm.session({
      1: {
        surfaces: [at("calendar", 140, 230, 560, 400), at("notes", 600, 300, 380, 300)],
        eris: null,
        rail: { visible: true },
        drawer: { visible: true },
      },
    });
    await window.__shell.wm.focus("notes");
  });
}

type Frame = { x: number; y: number; w: number; h: number; state: string; pinned: boolean };

/** Run desk command `id` with `args` as an agent's call reaches the desk. */
const run = (page: Page, id: string, args: Record<string, unknown>) =>
  page.evaluate(
    ([id, args]) => window.__shell.desk.runtime.commands.run(id as string, args) as Promise<Frame>,
    [id, args] as const,
  );

/** The window's box in the page, whole pixels. */
const box = (page: Page, id: string) =>
  page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`.surface[data-surface="${id}"]`);
    const r = el?.getBoundingClientRect();
    return (
      r && {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      }
    );
  }, id);

/** What desk.windows.list says of the window: where Eris reads it is. */
const listed = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    const desk = (await window.__shell.desk.runtime.commands.run("desk.windows.list")) as {
      windows: Array<{ id: string; x: number; y: number; w: number; h: number; state?: string }>;
    };
    const w = desk.windows.find((w) => w.id === id);
    return w && { x: w.x, y: w.y, w: w.w, h: w.h, state: w.state };
  }, id);

test("moves and resizes a window in pixels, and the page and desk.windows.list say the same", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  await seed(page);
  const moved = await run(page, "desk.windows.move", { window: "notes", x: 220, y: 160 });
  expect(moved).toMatchObject({ x: 220, y: 160, w: 380, h: 300, state: "normal" });
  await expect.poll(() => box(page, "notes")).toEqual({ x: 220, y: 160, w: 380, h: 300 });
  expect(await listed(page, "notes")).toEqual({ x: 220, y: 160, w: 380, h: 300, state: "normal" });

  const resized = await run(page, "desk.windows.resize", { window: "notes", w: 640, dh: 100 });
  expect(resized).toMatchObject({ x: 220, y: 160, w: 640, h: 400 });
  await expect.poll(() => box(page, "notes")).toEqual({ x: 220, y: 160, w: 640, h: 400 });
  expect(await listed(page, "notes")).toMatchObject({ w: 640, h: 400 });
});

test("snaps, maximizes and restores a window, and floats and pins it", async ({ page }) => {
  await openShell(page, "?lang=en");
  await seed(page);
  const left = await run(page, "desk.windows.fill", { window: "calendar", fill: "left" });
  expect(left).toMatchObject({ state: "snapped" });
  expect(await listed(page, "calendar")).toMatchObject({ state: "snapped", x: left.x, w: left.w });
  const full = await run(page, "desk.windows.fill", { window: "calendar", fill: "full" });
  expect(full.w).toBeGreaterThan(left.w);
  expect(await run(page, "desk.windows.fill", { window: "calendar", fill: "none" })).toMatchObject({
    x: 140,
    y: 230,
    w: 560,
    h: 400,
    state: "normal",
  });
  await expect.poll(() => box(page, "calendar")).toEqual({ x: 140, y: 230, w: 560, h: 400 });

  expect(await run(page, "desk.windows.float", { window: "notes", floating: true })).toMatchObject({
    state: "floating",
  });
  expect(await run(page, "desk.windows.pin", { window: "notes", pinned: true })).toMatchObject({
    pinned: true,
  });
  await expect(page.locator('.surface[data-surface="notes"]')).toHaveClass(/is-pinned/);
});
