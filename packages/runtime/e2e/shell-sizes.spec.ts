// The desk's own parts at the app's small sizes (#159, draft 05 #9 and #14; #158, draft 04 #15): at
// 1024×500, the smallest app window, and at 1100×600 no two of them lie on each other and each is
// inside the app, "New profile" can be pressed, the canvas reset button is in the strip under the
// canvas map (#296), and the status line is in sight. A notice that stays is a card above the windows that shows
// the whole of itself and can be dismissed.
import { expect, type Page, test } from "@playwright/test";
import { openShell } from "./shell-helpers";

/** The page's parts outside its windows, as the app's compositor takes them
 * (apps/desk/src/compositor-system.ts' PARTS, without the dialogs and overlays). */
const PARTS: ReadonlyArray<readonly [id: string, selector: string]> = [
  ["desk.profiles", '[data-layer="system"] .modes'],
  ["desk.desktops", '[data-layer="system"] .desktops'],
  ["desk.agents", '[data-layer="system"] .sidebar'],
  ["desk.account", '[data-layer="system"] .account-bar'],
  ["desk.rail", ".rail"],
  ["desk.bottom", "footer.bottom > *"],
  ["desk.canvas", ".map-strip"],
  ["desk.safe", '[data-layer="system"] .safe-badge'],
  ["desk.eris", ".eris"],
  ["desk.notices", ".desk-status"],
];

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Every part the page shows, one box for each element. */
const parts = (page: Page) =>
  page.evaluate((list) => {
    const out: Box[] = [];
    for (const [id, selector] of list) {
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        if (!el.checkVisibility({ visibilityProperty: true })) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        out.push({ id: `${id} ${el.className}`, x: r.x, y: r.y, w: r.width, h: r.height });
      }
    }
    return out;
  }, PARTS);

const meet = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The pairs of parts that lie on each other. */
function collisions(boxes: Box[]): string[] {
  const out: string[] = [];
  for (const [i, a] of boxes.entries())
    for (const b of boxes.slice(i + 1)) if (meet(a, b)) out.push(`${a.id} × ${b.id}`);
  return out;
}

/** The parts that reach past the app's edge. */
const outside = (boxes: Box[], width: number, height: number) =>
  boxes
    .filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > width + 0.5 || b.y + b.h > height + 0.5)
    .map((b) => `${b.id} [${[b.x, b.y, b.w, b.h].map(Math.round).join(",")}]`);

/** Whether the element `selector` finds is the topmost one at its own middle. */
const onTop = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top !== null && el.contains(top);
  }, selector);

const SIZES = [
  { width: 1024, height: 500 },
  { width: 1100, height: 600 },
  { width: 1280, height: 800 },
];

for (const size of SIZES) {
  test.describe(`at ${size.width}×${size.height}`, () => {
    test.use({ viewport: size });

    test("no two of the desk's parts lie on each other, and each is inside the app", async ({
      page,
    }) => {
      await openShell(page, "?lang=en");
      const boxes = await parts(page);
      expect(boxes.map((b) => b.id.split(" ")[0])).toEqual(
        expect.arrayContaining(["desk.profiles", "desk.agents", "desk.account", "desk.notices"]),
      );
      expect(collisions(boxes)).toEqual([]);
      expect(outside(boxes, size.width, size.height)).toEqual([]);
      expect(await onTop(page, '[data-layer="system"] .modes .mode-chip')).toBe(true);
    });

    test("on a panned canvas the reset button is whole, bottom right, and takes its press", async ({
      page,
    }) => {
      await openShell(page, "?lang=en");
      await page.evaluate(() => window.__shell.wm.panBy(-300, -200));
      const reset = page.locator(".map-strip .canvas-reset");
      await expect(reset).toBeEnabled();
      // The strip under the map: 24 from the right, 92 in an app under 734 high (draw_map.rs).
      const right = size.height < 734 ? 92 : 24;
      const strip = await page.locator(".map-strip").boundingBox();
      expect(strip).toEqual({
        x: size.width - right - 202,
        y: size.height - 64,
        width: 202,
        height: 32,
      });
      const box = await reset.boundingBox();
      if (!box || !strip) throw new Error("no box for the strip or its reset button");
      expect(box.x).toBeGreaterThanOrEqual(strip.x);
      expect(box.y).toBeGreaterThanOrEqual(strip.y);
      expect(box.x + box.width).toBeLessThanOrEqual(strip.x + strip.width);
      expect(box.y + box.height).toBeLessThanOrEqual(strip.y + strip.height);
      expect(collisions(await parts(page))).toEqual([]);
      expect(await onTop(page, ".map-strip .canvas-reset")).toBe(true);
      await reset.click();
      // Disabled at the origin, not gone.
      await expect(reset).toBeDisabled();
      await expect(reset).toHaveCount(1);
    });

    test("the running chips stay in sight with the talk line open, clear of the pill and the strip", async ({
      page,
    }) => {
      await openShell(page, "?lang=en");
      const chip = page.locator(".running .run-chip").first();
      await expect(chip).toBeVisible();
      const box = (selector: string) =>
        page.locator(selector).evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.className, x: r.x, y: r.y, w: r.width, h: r.height };
        });
      // At rest, beside the pill.
      const rest = await Promise.all([box(".running"), box(".composer"), box(".map-strip")]);
      expect(rest[0].w).toBeGreaterThan(0);
      expect(collisions(rest)).toEqual([]);
      await page.locator(".talk-launch").click();
      await expect(page.locator(".composer.is-open")).toBeVisible();
      // Once the line has opened to its width: two looks a frame apart that agree.
      await expect
        .poll(async () => {
          const a = (await box(".composer")).w;
          await page.waitForTimeout(100);
          return a === (await box(".composer")).w ? a : -1;
        })
        .toBeGreaterThan(184);
      const [running, first, pill, strip] = await Promise.all([
        box(".running"),
        box(".running > li:first-child .run-chip"),
        box(".composer"),
        box(".map-strip"),
      ]);
      expect(first.w).toBeGreaterThan(0);
      expect(running.w).toBeGreaterThan(0);
      expect(collisions([running, pill, strip])).toEqual([]);
    });

    test("the drawer's panel opened from the strip is whole inside the app", async ({ page }) => {
      await openShell(page, "?lang=en");
      await page.locator(".drawer-button").click();
      const panel = page.getByRole("dialog", { name: "Drawer" });
      await expect(panel.locator(".drawer-item")).toHaveCount(3);
      const r = await panel.boundingBox();
      if (!r) throw new Error("no box for the drawer's panel");
      expect(
        outside(
          [{ id: "drawer", x: r.x, y: r.y, w: r.width, h: r.height }],
          size.width,
          size.height,
        ),
      ).toEqual([]);
    });
  });
}

test.describe("a notice that stays", () => {
  test.use({ viewport: { width: 1024, height: 500 } });
  const TEXT =
    "Docker: open a shell in the container failed — Select a container, or name one with container.";

  test("is a card above the windows, says all of itself and can be dismissed", async ({ page }) => {
    await openShell(page, "?lang=en");
    await page.evaluate(() =>
      window.__shell.desk.runtime.notify({
        caller: "desk",
        title: "Docker: open a shell in the container failed",
        body: "Select a container, or name one with container.",
        level: "error",
      }),
    );
    const status = page.locator(".desk-status");
    await expect(status).toHaveText(TEXT);
    await expect(status).toHaveAttribute("data-level", "error");
    const card = await status.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return { r: [r.x, r.y, r.width, r.height], background: style.backgroundColor };
    });
    expect(card.background).not.toBe("rgba(0, 0, 0, 0)");
    const [x, y, w, h] = card.r as [number, number, number, number];
    expect(outside([{ id: "status", x, y, w, h }], 1024, 500)).toEqual([]);
    expect(await onTop(page, ".desk-status-text")).toBe(true);
    // One line above Eris while it is not pointed at: no part lies on another.
    expect(collisions(await parts(page))).toEqual([]);

    // Pointed at, it shows the whole of its text.
    const text = page.locator(".desk-status-text");
    const whole = () =>
      text.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight);
    expect(await whole()).toBe(false);
    await text.hover();
    await expect.poll(whole).toBe(true);
    expect(await text.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(18);

    await status.getByRole("button", { name: "Dismiss" }).click();
    await expect(status).not.toHaveAttribute("data-level", "error");
    const history = await page.evaluate(() =>
      window.__shell.desk.runtime.commands.run("desk.notify.history", { show: false }),
    );
    expect((history as Array<{ title: string }>)[0]?.title).toBe(
      "Docker: open a shell in the container failed",
    );
  });
});
