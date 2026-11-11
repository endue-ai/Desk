import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.projects (plugins/projects) on the browser stub's index (fixture/projects.ts: the plugin's own
// fixture tasks, or ?empty=1 for nothing connected), in the sandboxed frame a plugin page gets, at
// the sizes a person first meets it. A window's page is the window less its 40 px title bar and
// border: the first window is 328×211 at 1280×800 (page 326×169) and 381×261 at 1440×900 (379×219);
// it was 402×305 (400×263); the cascade makes 643×339 (641×297).
const SURFACE = '[data-surface="endue.projects"]';
const FIRST = { width: 326, height: 169 };
const FIRST_1440 = { width: 379, height: 219 };
const EARLIER = { width: 400, height: 263 };
const CASCADE = { width: 641, height: 297 };
type Size = typeof FIRST;
type Box = { left: number; top: number; right: number; bottom: number };

// The fixture tasks are due around 30 October 2026: the timeline and the calendar show them then.
test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-30T12:00:00Z"));
});

/** Open the fixture page and endue.projects at a size, and resolve with its frame once it drew. */
async function open(page: Page, size: Size, query = "") {
  await page.goto(`/projects.html${query}`);
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.projects" }),
  );
  const iframe = page.locator(`${SURFACE} iframe`);
  await expect(iframe).toBeVisible();
  await iframe.evaluate((el, { width, height }) => {
    el.style.cssText += `;width:${width}px!important;height:${height}px!important`;
  }, size);
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.projects frame");
  await expect(frame.locator("#views [role=tab]")).toHaveCount(6);
  await expect(
    frame.locator(query.includes("empty") ? ".empty [data-connect]" : ".card").first(),
  ).toBeVisible();
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

const within = (inner: Box | null, outer: Box | null) =>
  inner !== null &&
  outer !== null &&
  inner.left >= outer.left - 0.5 &&
  inner.top >= outer.top - 0.5 &&
  inner.right <= outer.right + 0.5 &&
  inner.bottom <= outer.bottom + 0.5;

/** The page's own box: nothing in it may need a sideways scroll of the page. */
const pageBox = (size: Size): Box => ({ left: 0, top: 0, right: size.width, bottom: size.height });

/** Show a view by its tab, as a person does. */
async function show(frame: Frame, view: string) {
  await frame.locator(`#views [data-view="${view}"]`).click();
  await expect(frame.locator(`#views [data-view="${view}"]`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

/** Press the pointer at the middle of an element, where it is, without scrolling anything. */
async function pressAt(page: Page, frame: Frame, selector: string) {
  const at = await box(frame, selector);
  const origin = await page.locator(`${SURFACE} iframe`).boundingBox();
  if (!at || !origin) throw new Error(`no ${selector}`);
  await page.mouse.click(origin.x + (at.left + at.right) / 2, origin.y + (at.top + at.bottom) / 2);
}

test.describe("endue.projects at its first sizes", () => {
  for (const size of [FIRST, FIRST_1440, EARLIER]) {
    test(`nothing connected at ${size.width}×${size.height}: the words and Connect a source are in view in every view, and a press reaches the button`, async ({
      page,
    }) => {
      const frame = await open(page, size, "?empty=1");
      for (const view of ["kanban", "timeline", "calendar", "list"]) {
        await show(frame, view);
        // Nothing to search, group or page through: the toolbar is the views and refresh.
        await expect(frame.locator("#filters")).toBeHidden();
        await expect(frame.locator("#period")).toBeHidden();
        const body = await box(frame, "#body");
        for (const part of [".empty p", ".empty [data-connect]"])
          expect(within(await box(frame, part), body), `${view}: ${part}`).toBe(true);
        expect(within(await box(frame, "#bar"), pageBox(size)), `${view}: the toolbar`).toBe(true);
        expect(await frame.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
      }
      await frame.evaluate(() => {
        const w = window as unknown as { pressed: number };
        w.pressed = 0;
        document.addEventListener("click", (e) => {
          if ((e.target as Element).closest("[data-connect]")) w.pressed++;
        });
      });
      const top = await frame.evaluate(() => document.getElementById("body")?.scrollTop);
      await pressAt(page, frame, ".empty [data-connect]");
      expect(await frame.evaluate(() => (window as unknown as { pressed: number }).pressed)).toBe(
        1,
      );
      expect(await frame.evaluate(() => document.getElementById("body")?.scrollTop)).toBe(top);
    });
  }

  test("with tasks at 326×169: the tabs and refresh on one row, the filters on the next, the period on a third line of its own", async ({
    page,
  }) => {
    const frame = await open(page, FIRST);
    const row = async (selector: string) => (await box(frame, selector))?.top ?? -1;
    expect(await row("#refresh")).toBe(await row("#views"));
    expect(await row("#search")).toBeGreaterThan(await row("#views"));
    expect(within(await box(frame, "#bar"), pageBox(FIRST))).toBe(true);
    // Two rows of controls leave the view most of the page.
    const body = await box(frame, "#body");
    expect((body?.bottom ?? 0) - (body?.top ?? 0)).toBeGreaterThanOrEqual(96);
    // Every tab can be reached: the strip scrolls sideways, not the page.
    await show(frame, "calendar");
    expect(
      within(await box(frame, '#views [data-view="calendar"]'), await box(frame, "#views")),
    ).toBe(true);
    await show(frame, "timeline");
    expect(await row("#refresh")).toBe(await row("#views"));
    // The period's words stay on one line, beside its buttons and the zoom.
    const title = await frame.evaluate(() => {
      const el = document.getElementById("period-title") as HTMLElement;
      return {
        height: el.getBoundingClientRect().height,
        line: parseFloat(getComputedStyle(el).lineHeight),
      };
    });
    expect(title.height).toBeLessThanOrEqual(title.line + 1);
    expect(await row("#zoom")).toBe(await row("#prev"));
    for (const part of ["#prev", "#today", "#next", "#period-title", "#zoom", "#refresh"])
      expect(within(await box(frame, part), pageBox(FIRST)), part).toBe(true);
    expect(await frame.evaluate(() => document.documentElement.scrollWidth)).toBe(FIRST.width);
  });

  test("with tasks at 326×169: a list row's title has a line of its own, and the details cover the view", async ({
    page,
  }) => {
    const frame = await open(page, FIRST);
    await show(frame, "list");
    const title = await box(frame, ".row .row-title");
    expect((title?.right ?? 0) - (title?.left ?? 0)).toBeGreaterThanOrEqual(240);
    await frame.locator(".row").first().click();
    await expect(frame.locator("#detail")).toBeVisible();
    expect(await box(frame, "#detail")).toEqual(await box(frame, "#body"));
    expect(within(await box(frame, "#detail-title"), await box(frame, "#detail"))).toBe(true);
    await frame.locator("#detail .close").click();
    await expect(frame.locator("#detail")).toBeHidden();
  });

  test("at the cascade's size the heading shows, and a drag across the toolbar selects none of its words", async ({
    page,
  }) => {
    const frame = await open(page, CASCADE);
    await expect(frame.locator("#title")).toBeVisible();
    const origin = await page.locator(`${SURFACE} iframe`).boundingBox();
    const heading = await box(frame, "#title");
    const strip = await box(frame, "#views");
    if (!origin || !heading || !strip) throw new Error("no toolbar");
    const y = origin.y + (heading.top + heading.bottom) / 2;
    await page.mouse.move(origin.x + heading.left + 2, y);
    await page.mouse.down();
    await page.mouse.move(origin.x + strip.right - 4, y, { steps: 8 });
    await page.mouse.up();
    expect(await frame.evaluate(() => String(getSelection()))).toBe("");
  });

  test("the fields, the check and the tabs are the design system's, not the input border's colour", async ({
    page,
  }) => {
    const frame = await open(page, EARLIER);
    const looks = await frame.evaluate(() => {
      const probe = document.createElement("div");
      document.body.append(probe);
      /** A token as the browser computes it for `property`. */
      const token = (property: string, value: string) => {
        probe.style.setProperty(property, value);
        return getComputedStyle(probe).getPropertyValue(property);
      };
      const css = (selector: string) =>
        getComputedStyle(document.querySelector(selector) as Element);
      return {
        fieldBg: token("background-color", "var(--desk-field-bg)"),
        inputColour: token("background-color", "var(--desk-input)"),
        fieldBorder: token("border-top-color", "var(--desk-field-border-color)"),
        accent: token("accent-color", "var(--desk-check-accent)"),
        search: css("#search").backgroundColor,
        searchBorder: css("#search").borderTopColor,
        group: css("#group").backgroundColor,
        zoom: css("#zoom").backgroundColor,
        done: css("#done").accentColor,
        tab: document.querySelector("#views [role=tab]")?.className,
      };
    });
    expect(looks.search).toBe(looks.fieldBg);
    expect(looks.search).not.toBe(looks.inputColour);
    expect(looks.searchBorder).toBe(looks.fieldBorder);
    expect(looks.group).toBe(looks.fieldBg);
    expect(looks.zoom).toBe(looks.fieldBg);
    expect(looks.done).toBe(looks.accent);
    expect(looks.tab).toContain("desk-tab");
  });
});
