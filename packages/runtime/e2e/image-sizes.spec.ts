import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.images (plugins/images) on the browser stub, in the sandboxed frame a plugin page gets, at the
// sizes a person meets it (#162, QA draft 08 #9): the window the desk first opens, less its title bar
// and border (326×169 at 1280×800, 379×219 at 1440×900, 400×263 before ADR 0182), and 298×178 when a
// window is shrunk to 300×220. The image keeps most of the frame, and every tool of the toolbar can
// be reached: the row scrolls sideways under a wheel, its hidden end fades, and a tool brought into
// view takes a press.
const SURFACE = '[data-surface="endue.images"]';
const SIZES = {
  first: { width: 326, height: 169 },
  "first at 1440": { width: 379, height: 219 },
  "first before": { width: 400, height: 263 },
  small: { width: 298, height: 178 },
  large: { width: 898, height: 588 },
};

test.use({ locale: "en-US", viewport: { width: 1280, height: 900 } });

/** Open the fixture page and `path` in endue.images at `size`, and resolve with its frame. */
async function open(page: Page, path: string, size: { width: number; height: number }) {
  await page.goto("/images.html");
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
  if (!frame) throw new Error("no endue.images frame");
  await expect.poll(() => frame.evaluate(() => innerHeight)).toBe(size.height);
  await expect
    .poll(() =>
      frame.evaluate(() => {
        const img = document.querySelector<HTMLImageElement>("#pane-a img");
        return !!img && img.complete && img.naturalWidth > 0;
      }),
    )
    .toBe(true);
  return frame;
}

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

const height = (frame: Frame, selector: string) =>
  frame.evaluate((s) => document.querySelector(s)?.getBoundingClientRect().height ?? 0, selector);

/** Whether the page itself scrolls: what it holds is taller or wider than the frame. */
const overflows = (frame: Frame) =>
  frame.evaluate(() => {
    const page = document.scrollingElement ?? document.documentElement;
    return page.scrollHeight > innerHeight + 1 || page.scrollWidth > innerWidth + 1;
  });

/** Turn the wheel over the toolbar, as a person with a mouse does, until `selector` is in view. */
async function wheelTo(page: Page, frame: Frame, selector: string) {
  const bar = await frame.locator("#toolbar").boundingBox();
  if (!bar) throw new Error("no toolbar");
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  for (let turn = 0; turn < 20 && (await inView(frame, selector)) !== true; turn++) {
    // Down scrolls the row toward its end, up toward its start.
    const right = await frame.evaluate(
      (s) => (document.querySelector(s)?.getBoundingClientRect().right ?? 0) > innerWidth,
      selector,
    );
    await page.mouse.wheel(0, right ? 60 : -60);
    await page.waitForTimeout(50);
  }
}

for (const [name, size] of Object.entries(SIZES)) {
  test.describe(`endue.images at ${name} (${size.width}×${size.height})`, () => {
    test("the image keeps most of the frame, and the page does not scroll", async ({ page }) => {
      const frame = await open(page, "~/Documents/photo.jpg", size);
      expect(await height(frame, "#stage")).toBeGreaterThanOrEqual(size.height / 2);
      expect(await inView(frame, "#name")).toBe(true);
      expect(await inView(frame, "#previous")).toBe(true);
      expect(await overflows(frame)).toBe(false);
    });

    test("every tool can be reached by the wheel, and takes a press there", async ({ page }) => {
      const frame = await open(page, "~/Documents/photo.jpg", size);
      const tools = await frame.evaluate(() =>
        [...document.querySelectorAll("#toolbar button")].map((b) => `#${b.id}`),
      );
      expect(tools).toContain("#details-toggle");
      const hidden = [];
      for (const tool of tools) if ((await inView(frame, tool)) !== true) hidden.push(tool);
      // A window wide enough shows them all (and this page's window clips a frame that large).
      if (size.width >= 720) return expect(hidden).toEqual([]);
      // What the row hides is said: its end fades.
      expect(await frame.evaluate(() => document.getElementById("toolbar")?.dataset.more)).toBe(
        "end",
      );
      await wheelTo(page, frame, "#details-toggle");
      expect(await inView(frame, "#details-toggle")).toBe(true);
      const at = await frame.locator("#details-toggle").boundingBox();
      if (!at) throw new Error("no Details");
      await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
      await expect(frame.locator("#details")).toBeVisible();
      for (const tool of hidden) {
        await wheelTo(page, frame, tool);
        expect(await inView(frame, tool)).toBe(true);
      }
    });
  });
}
