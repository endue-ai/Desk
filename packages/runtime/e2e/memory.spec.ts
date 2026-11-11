import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.memory (plugins/memory) on the browser stub's memory.* (plugins/memory/tests/fixtures.ts: two
// facts and a conversation), in the sandboxed frame a plugin page gets (scripts only, no modals), so
// window.confirm would be ignored here as it is in the app. "First size" is the page of a window
// as the desk first opens one: 402×305 less its 40 px title bar and border, 400×263.
const SURFACE = '[data-surface="endue.memory"]';
const FIRST = { width: 400, height: 263 };

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

/** Open the fixture page and endue.memory, and resolve with its frame once the entries show. */
async function open(page: Page, query = "", size?: { width: number; height: number }) {
  await page.goto(`/memory.html${query}`);
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.memory" }),
  );
  const iframe = page.locator(`${SURFACE} iframe`);
  await expect(iframe).toBeVisible();
  if (size)
    await iframe.evaluate((el, { width, height }) => {
      el.style.cssText += `;width:${width}px!important;height:${height}px!important`;
    }, size);
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.memory frame");
  await expect(frame.locator("#entries > li.entry").first()).toBeVisible();
  if (size) await expect.poll(() => frame.evaluate(() => innerHeight)).toBe(size.height);
  return frame;
}

const texts = (frame: Frame) => frame.locator("#entries .text").allTextContents();

/** Whether `selector`'s first match lies whole inside the frame's viewport and inside `within`. */
const inside = (frame: Frame, selector: string, within = "body") =>
  frame.evaluate(
    ([selector, within]) => {
      const el = document.querySelector(selector as string);
      const box = document.querySelector(within as string);
      if (!el || !box) return `no ${el ? within : selector}`;
      const r = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const top = Math.max(0, b.top);
      const bottom = Math.min(innerHeight, b.bottom);
      const ok = r.top >= top && r.bottom <= bottom && r.left >= 0 && r.right <= innerWidth;
      return ok || `${selector} ${[r.left, r.top, r.right, r.bottom]} outside ${[top, bottom]}`;
    },
    [selector, within],
  );

test.describe("endue.memory", () => {
  test("Forget everything asks in the page's own dialog, and forgets the kind shown on yes", async ({
    page,
  }) => {
    const ignored: string[] = [];
    page.on("console", (message) => {
      if (/confirm\(\)|allow-modals/.test(message.text())) ignored.push(message.text());
    });
    const frame = await open(page);
    await frame.getByRole("tab", { name: "Facts" }).click();
    await expect
      .poll(() => texts(frame))
      .toEqual(["Prefers pnpm over npm", "Reviews pull requests in the morning"]);
    const dialog = frame.locator("#ask-dialog");
    const forgetAll = frame.locator("#forget-all");

    // Cancel, then Escape: the question goes and every fact stays.
    await forgetAll.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#ask-title")).toHaveText("Forget every fact?");
    await expect(dialog.locator("#ask-text")).toContainText("2 facts");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await forgetAll.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect.poll(() => texts(frame)).toHaveLength(2);

    // Yes: the facts are forgotten, the conversation is kept.
    await forgetAll.click();
    await dialog.getByRole("button", { name: "Forget 2 facts" }).click();
    await expect(dialog).toBeHidden();
    await expect(frame.locator("#entries .empty")).toHaveText("Eris keeps no facts about you yet.");
    await expect(frame.locator("#status")).toHaveText("Forgot 2 facts.");
    await expect(forgetAll).toBeDisabled();
    await frame.getByRole("tab", { name: "All" }).click();
    await expect.poll(() => texts(frame)).toEqual(["“check my latest mail”"]);
    expect(ignored).toEqual([]);
  });

  test("at the first size the list shows entries, and the question fits", async ({ page }) => {
    const frame = await open(page, "", FIRST);
    const list = await frame.evaluate(() => document.querySelector("main")?.clientHeight ?? 0);
    expect(list).toBeGreaterThanOrEqual(130);
    for (const nth of [1, 2])
      expect(await inside(frame, `#entries > li:nth-child(${nth}) .text`, "main")).toBe(true);

    await frame.locator("#forget-all").click();
    await expect(frame.locator("#ask-dialog")).toBeVisible();
    for (const part of ["#ask-title", "#ask-text", "#ask-no", "#ask-yes"])
      expect(await inside(frame, part)).toBe(true);
  });

  test("a long conversation shows a few lines until the person asks for all of it", async ({
    page,
  }) => {
    const frame = await open(page, "?long=1", FIRST);
    const entry = frame.locator("#entries > li").first();
    const height = async () => (await entry.boundingBox())?.height ?? 0;
    expect(await height()).toBeLessThanOrEqual(150);
    const more = entry.getByRole("button", { name: "Show all" });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(entry.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(await height()).toBeGreaterThan(400);
    await entry.getByRole("button", { name: "Show less" }).click();
    expect(await height()).toBeLessThanOrEqual(150);
  });
});
