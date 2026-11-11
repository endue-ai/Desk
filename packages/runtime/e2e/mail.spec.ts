import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.mail (plugins/mail) on the browser stub with no mail account connected, in the sandboxed frame a
// plugin page gets, at the sizes the desk first gives a window (#160, QA draft 06 #9): 402×305 when it
// opens one, 643×339 after Cascade. Each is the window less its 40 px title bar and 2 px of border.
const SURFACE = '[data-surface="endue.mail"]';
const SIZES = {
  first: { width: 400, height: 263 },
  cascade: { width: 641, height: 297 },
};
/** A 900×600 window: the three columns, as before. */
const LARGE = { width: 898, height: 558 };
const MAILBOXES = ["Inbox", "Unread", "Flagged", "Sent", "Drafts", "Archive", "Trash", "Junk"];

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

/** Open the fixture page and endue.mail at `size`, and resolve with its frame once the mailboxes show. */
async function open(page: Page, size: { width: number; height: number }) {
  await page.goto("/mail.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.mail" }),
  );
  const iframe = page.locator(`${SURFACE} iframe`);
  await expect(iframe).toBeVisible();
  await iframe.evaluate((el, { width, height }) => {
    el.style.cssText += `;width:${width}px!important;height:${height}px!important`;
  }, size);
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.mail frame");
  await expect(frame.locator("#mailboxes button")).toHaveCount(MAILBOXES.length);
  await expect.poll(() => frame.evaluate(() => innerHeight)).toBe(size.height);
  return frame;
}

/**
 * Whether `selector`'s first match lies whole inside the frame's viewport and inside what `within`
 * shows of it (its box less what it scrolls out of view), or what is outside.
 */
const inside = (frame: Frame, selector: string, within = "body") =>
  frame.evaluate(
    ([selector, within]) => {
      const el = document.querySelector(selector as string);
      const box = document.querySelector(within as string);
      if (!el || !box) return `no ${el ? within : selector}`;
      const r = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const [top, bottom] = [Math.max(0, b.top), Math.min(innerHeight, b.bottom)];
      const [left, right] = [Math.max(0, b.left), Math.min(innerWidth, b.right)];
      const ok =
        r.width > 0 && r.top >= top && r.bottom <= bottom && r.left >= left && r.right <= right;
      return (
        ok ||
        `${selector} ${[r.left, r.top, r.right, r.bottom]} outside ${[left, top, right, bottom]}`
      );
    },
    [selector, within],
  );

/** The rounded box of `selector`'s first match in the frame. */
const box = (frame: Frame, selector: string) =>
  frame.evaluate((selector) => {
    const r = document.querySelector(selector)?.getBoundingClientRect();
    return (
      r && { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }
    );
  }, selector);

test.describe("endue.mail at the first sizes", () => {
  for (const [name, size] of Object.entries({ ...SIZES, large: LARGE })) {
    test(`${name} (${size.width}×${size.height}): every mailbox and both tools are in view`, async ({
      page,
    }) => {
      const frame = await open(page, size);
      expect(await frame.locator("#mailboxes button").allTextContents()).toEqual(MAILBOXES);
      for (let nth = 1; nth <= MAILBOXES.length; nth++)
        expect(await inside(frame, `#mailboxes li:nth-child(${nth}) button`, "#nav")).toBe(true);
      // The nav needs no scrolling, and New message and Refresh sit on one row beside the title.
      expect(
        await frame.evaluate(() => {
          const nav = document.getElementById("nav") as HTMLElement;
          return nav.scrollHeight - nav.clientHeight;
        }),
      ).toBeLessThanOrEqual(0);
      const [compose, refresh] = [await box(frame, "#compose"), await box(frame, "#refresh")];
      expect(compose?.top).toBe(refresh?.top);
      for (const part of ["#compose", "#refresh", "#search"])
        expect(await inside(frame, part)).toBe(true);
    });
  }

  for (const [name, size] of Object.entries(SIZES)) {
    test(`${name} (${size.width}×${size.height}): New message gets the page, and every field and button is in view`, async ({
      page,
    }) => {
      const frame = await open(page, size);
      await frame.locator("#compose").click();
      await expect(frame.locator("#composer")).toBeVisible();
      for (const part of [
        "#composer h2",
        "#composer [name=to]",
        "#composer [name=cc]",
        "#composer [name=bcc]",
        "#composer [name=subject]",
        "#composer [name=body]",
        "#composer [type=submit]",
        "#composer [data-close]",
        "#composer [data-discard]",
      ])
        expect(await inside(frame, part, "#pane")).toBe(true);
      // The text has room for a few lines, and the composer is not a slot under the list.
      expect((await box(frame, "#composer [name=body]"))?.height).toBeGreaterThanOrEqual(54);
      await expect(frame.locator("#messages")).toBeHidden();
      const [pane, status] = [await box(frame, "#pane"), await box(frame, "#status")];
      expect(pane?.top).toBe(0);
      expect(pane?.bottom).toBe(status?.top);
      await expect(frame.locator("#composer [name=to]")).toBeFocused();
    });
  }

  test("an open message sits under the list, beside every mailbox", async ({ page }) => {
    const frame = await open(page, SIZES.cascade);
    const row = frame.locator("#list [role=option]").first();
    await row.click();
    await expect(frame.locator("#reader")).toBeVisible();
    expect(await inside(frame, "#list [role=option]", "#messages")).toBe(true);
    expect(await inside(frame, "#reader h2", "#pane")).toBe(true);
    const [list, pane] = [await box(frame, "#messages"), await box(frame, "#pane")];
    expect(pane?.top).toBe(list?.bottom);
    for (let nth = 1; nth <= MAILBOXES.length; nth++)
      expect(await inside(frame, `#mailboxes li:nth-child(${nth}) button`, "#nav")).toBe(true);
  });

  test("opening and closing an empty new message keeps no draft", async ({ page }) => {
    const frame = await open(page, SIZES.cascade);
    const drafts = frame.locator('#mailboxes [data-mailbox="drafts"]');
    await expect(drafts).toHaveText("Drafts");
    await frame.locator("#compose").click();
    await expect(frame.locator("#composer")).toBeVisible();
    await frame.locator("#composer [data-close]").click();
    await expect(frame.locator("#composer")).toBeHidden();
    await expect(frame.locator("#messages")).toBeVisible();
    await expect(drafts).toHaveText("Drafts");
    // Escape on an empty message is the same, and a written one is kept.
    await frame.locator("#compose").click();
    await frame.locator("#composer [name=to]").press("Escape");
    await expect(frame.locator("#composer")).toBeHidden();
    await expect(drafts).toHaveText("Drafts");
    await frame.locator("#compose").click();
    await frame.locator("#composer [name=subject]").fill("Lunch");
    await frame.locator("#composer [data-close]").click();
    await expect(drafts).toHaveText("Drafts1");
  });
});
