import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.player (plugins/player) on the browser stub, in the sandboxed frame a plugin page gets, at the
// sizes a person meets it (#162, QA draft 08 #8 and #9): the window the desk first opens, less its
// title bar and border (326×169 at 1280×800, 379×219 at 1440×900, 400×263 before ADR 0182), and
// 298×178 when a window is shrunk to 300×220. The file comes first and the player's own chrome folds:
// a picture or the song's card, Play and the seek bar in view, nothing scrolled out of the page.
const SURFACE = '[data-surface="endue.player"]';
const SIZES = {
  first: { width: 326, height: 169 },
  "first at 1440": { width: 379, height: 219 },
  "first before": { width: 400, height: 263 },
  small: { width: 298, height: 178 },
  large: { width: 898, height: 588 },
};

test.use({ locale: "en-US", viewport: { width: 1280, height: 900 } });

/** Open the fixture page and `path` in endue.player at `size`, and resolve with its frame. */
async function open(page: Page, path: string, size: { width: number; height: number }) {
  await page.goto("/player.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(
    (path) => window.__desk.runtime.commands.run("desk.files.open", { path }),
    path,
  );
  const iframe = page.locator(`${SURFACE} iframe`);
  await expect(iframe).toBeVisible();
  await iframe.evaluate((el, { width, height }) => {
    el.style.cssText += `;width:${width}px!important;height:${height}px!important`;
  }, size);
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.player frame");
  await expect.poll(() => frame.evaluate(() => innerHeight)).toBe(size.height);
  await expect(frame.locator("#transport")).toBeVisible();
  return frame;
}

/** `selector`'s first match: its box, rounded, or null when it is not drawn. */
const box = (frame: Frame, selector: string) =>
  frame.evaluate((selector) => {
    const el = document.querySelector(selector);
    const r = el?.getBoundingClientRect();
    if (!el || !r || r.width === 0 || r.height === 0) return null;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height };
  }, selector);

/** Whether `selector`'s first match is drawn whole inside the frame's viewport, or where it is. */
const inView = (frame: Frame, selector: string) =>
  frame.evaluate((selector) => {
    const r = document.querySelector(selector)?.getBoundingClientRect();
    if (!r || r.width === 0) return `${selector} is not drawn`;
    const ok =
      r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5;
    return (
      ok || `${selector} ${[r.left, r.top, r.right, r.bottom]} outside ${innerWidth}×${innerHeight}`
    );
  }, selector);

/** Whether the page itself scrolls: what it holds is taller or wider than the frame. */
const overflows = (frame: Frame) =>
  frame.evaluate(() => {
    const page = document.scrollingElement ?? document.documentElement;
    return page.scrollHeight > innerHeight + 1 || page.scrollWidth > innerWidth + 1;
  });

for (const [name, size] of Object.entries(SIZES)) {
  test.describe(`endue.player at ${name} (${size.width}×${size.height})`, () => {
    test("a video shows its picture first, with Play and the seek bar in view", async ({
      page,
    }) => {
      const frame = await open(page, "~/Movies/clip.webm", size);
      await expect(frame.locator("#video")).toBeVisible();
      const picture = await box(frame, "#video");
      expect(picture, "the picture is drawn").not.toBeNull();
      // At least half the frame is the picture's room, whatever its own shape.
      const stage = await box(frame, "#stage");
      expect(stage?.height ?? 0).toBeGreaterThanOrEqual(size.height / 2);
      expect(await inView(frame, "#video")).toBe(true);
      expect(await inView(frame, "#play")).toBe(true);
      expect(await inView(frame, "#seek")).toBe(true);
      expect(await overflows(frame)).toBe(false);
    });

    test("a song shows its card, with Play and the seek bar in view", async ({ page }) => {
      const frame = await open(page, "~/Music/tone.ogg", size);
      await expect(frame.locator("#card")).toBeVisible();
      expect(await inView(frame, "#card > :is(#cover, #no-cover):not([hidden])")).toBe(true);
      expect(await inView(frame, "#play")).toBe(true);
      expect(await inView(frame, "#seek")).toBe(true);
      expect(await overflows(frame)).toBe(false);
    });

    test("a playlist keeps the stage, and Previous and Next in view", async ({ page }) => {
      const frame = await open(page, "~/Music/mix.m3u", size);
      await expect(frame.locator("#next")).toBeVisible();
      // The list beside or under the stage leaves it at least half the frame each way.
      const stage = await box(frame, "#stage");
      expect(stage?.height ?? 0).toBeGreaterThanOrEqual(size.height / 2);
      expect((stage?.right ?? 0) - (stage?.left ?? 0)).toBeGreaterThanOrEqual(size.width / 2);
      const card = await box(frame, "#card");
      expect(card, "the song's card is drawn").not.toBeNull();
      expect(await inView(frame, "#next")).toBe(true);
      expect(await inView(frame, "#play")).toBe(true);
      expect(await overflows(frame)).toBe(false);
    });
  });
}
