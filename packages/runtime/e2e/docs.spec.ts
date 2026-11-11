import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.docs (plugins/docs) on the browser stub with its fixture document open (fixture/docs.ts:
// rich.docx, with headings and a comment), in the sandboxed frame a plugin page gets, at the sizes a
// person first meets it (#162, QA draft 08 #8 and #9). A window's page is the window less its 40 px
// title bar and border: the first window is 328×211 at 1280×800 (page 326×169); it was 402×305
// (400×263); a window made small by its edges, 300×220 (298×178); the cascade makes 643×339 (641×297).
const SURFACE = '[data-surface="endue.docs"]';
const SMALL = [
  { width: 326, height: 169 },
  { width: 400, height: 263 },
  { width: 298, height: 178 },
  { width: 641, height: 297 },
];
/** A 900×600 window: the outline and the comments beside the pages, as before. */
const LARGE = { width: 898, height: 558 };
type Size = (typeof SMALL)[number];
type Box = { left: number; top: number; right: number; bottom: number };

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

/** Open the fixture page and rich.docx at `size`, and resolve with Docs' frame once a page is drawn. */
async function open(page: Page, size: Size): Promise<Frame> {
  await page.goto("/docs.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.files.open", { path: "~/Documents/rich.docx" }),
  );
  const iframe = page.locator(`${SURFACE} iframe`);
  await expect(iframe).toBeVisible();
  await iframe.evaluate((el, { width, height }) => {
    el.style.cssText += `;width:${width}px!important;height:${height}px!important`;
  }, size);
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.docs frame");
  await expect(frame.locator("#doc-name")).toHaveText("rich.docx");
  await expect(frame.locator(".page").first()).toBeVisible();
  await expect.poll(() => frame.evaluate(() => innerHeight)).toBe(size.height);
  return frame;
}

/** An element's box in the frame, or null when it is not drawn. */
const box = (frame: Frame, selector: string) =>
  frame.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el || el.getClientRects().length === 0) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, selector);
const height = (b: Box | null) => (b ? b.bottom - b.top : 0);

/** How much of the first page shows inside the pages' view, in square pixels. */
const pageShown = (frame: Frame) =>
  frame.evaluate(() => {
    const view = document.getElementById("desk")?.getBoundingClientRect();
    const first = document.querySelector(".page")?.getBoundingClientRect();
    if (!view || !first) return 0;
    const w = Math.min(view.right, first.right, innerWidth) - Math.max(view.left, first.left, 0);
    const h = Math.min(view.bottom, first.bottom, innerHeight) - Math.max(view.top, first.top, 0);
    return Math.max(0, w) * Math.max(0, h);
  });

test.describe("endue.docs at its first and small sizes", () => {
  for (const size of SMALL) {
    test(`at ${size.width}×${size.height} the document comes first: the pages take the page's width and most of its height`, async ({
      page,
    }) => {
      const frame = await open(page, size);
      const view = await box(frame, "#desk");
      expect(view, "the pages' view is drawn").not.toBeNull();
      // The outline and the comments are folded: nothing stands beside the pages.
      expect(await box(frame, "#outline")).toBeNull();
      expect(await box(frame, "#comments")).toBeNull();
      expect(view?.left).toBeLessThanOrEqual(0.5);
      expect(view?.right).toBeGreaterThanOrEqual(size.width - 0.5);
      expect(height(view)).toBeGreaterThanOrEqual(size.height * 0.55);
      expect(await pageShown(frame)).toBeGreaterThan(size.width * size.height * 0.25);
      // The status line lies under the pages, not over them, and inside the page.
      const status = await box(frame, "#status");
      expect(status?.top).toBeGreaterThanOrEqual((view?.bottom ?? 0) - 0.5);
      expect(status?.bottom).toBeLessThanOrEqual(size.height + 0.5);
      // Nothing makes the page itself scroll sideways.
      expect(
        await frame.evaluate(() => document.scrollingElement?.scrollWidth ?? 0),
      ).toBeLessThanOrEqual(size.width);
    });
  }

  for (const size of SMALL.filter((s) => s.width < 560)) {
    test(`at ${size.width}×${size.height} the header is one row, and its tools scroll sideways rather than wrap`, async ({
      page,
    }) => {
      const frame = await open(page, size);
      const bar = await box(frame, "#bar");
      const name = await box(frame, "#doc-name");
      const fit = await box(frame, "#outline-toggle");
      expect(height(bar)).toBeLessThanOrEqual(40);
      // The name and the tools share the row.
      expect(Math.abs((name?.top ?? 0) - (fit?.top ?? 99))).toBeLessThan(12);
      expect((name?.right ?? 0) - (name?.left ?? 0)).toBeGreaterThan(30);
      // The last tool is reached by scrolling the toolbar, not lost under the edge.
      await frame.locator("#zoom-fit").scrollIntoViewIfNeeded();
      const last = await box(frame, "#zoom-fit");
      expect(last?.right).toBeLessThanOrEqual(size.width + 0.5);
    });
  }

  test("at 400×263 the outline opens over the pages, takes a heading, and folds to show it", async ({
    page,
  }) => {
    const frame = await open(page, SMALL[1] as Size);
    await frame.locator("#outline-toggle").click();
    await expect(frame.locator("#outline")).toBeVisible();
    await expect(frame.locator("#outline-toggle")).toHaveAttribute("aria-pressed", "true");
    const outline = await box(frame, "#outline");
    expect(outline?.right).toBeLessThanOrEqual(400);
    const heading = frame.locator("#outline-list button").first();
    await expect(heading).toBeVisible();
    await heading.click();
    await expect(frame.locator("#outline")).toBeHidden();
    await frame.locator("#comments-toggle").click();
    await expect(frame.locator("#comments")).toBeVisible();
    await frame.locator("#desk").press("Escape");
    await expect(frame.locator("#comments")).toBeHidden();
  });

  test("at 898×558 the outline and the comments stand beside the pages", async ({ page }) => {
    const frame = await open(page, LARGE);
    const outline = await box(frame, "#outline");
    const view = await box(frame, "#desk");
    const comments = await box(frame, "#comments");
    expect(outline).not.toBeNull();
    expect(comments).not.toBeNull();
    expect(view?.left).toBeGreaterThanOrEqual((outline?.right ?? 0) - 0.5);
    expect(view?.right).toBeLessThanOrEqual((comments?.left ?? 0) + 0.5);
  });
});
