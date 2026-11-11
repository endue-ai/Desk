import { expect, type Frame, type Page, test } from "@playwright/test";
import { viewTree } from "./view-tree";

// desk.today (plugins/today), a page of universal views (ADR 0103) that desk.views hands to
// desk.universal, on the browser stub's fixture items (views.html), at the stub's clock: Friday 30
// October 2026, 9 in the morning in Seoul.
const UNIVERSAL = '[data-surface="desk.universal"]';
const PALETTE = '[data-surface="desk.palette"]';

test.use({ timezoneId: "Asia/Seoul", locale: "en-US" });

async function load(page: Page, query = ""): Promise<void> {
  await page.clock.setFixedTime("2026-10-30T09:00:00+09:00");
  await page.goto(`/views.html${query}`);
  await page.waitForFunction(() => window.__views !== undefined);
  await page.evaluate(() => window.__views.ready);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  for (const id of [
    "desk.views.open",
    "desk.universal.open",
    "desk.today.open",
    "desk.palette.open",
  ])
    await expect
      .poll(() => page.evaluate((c) => window.__desk.runtime.commands.has(c), id))
      .toBe(true);
}

/** desk.universal's frame with the Today page drawn, once its overlay shows. */
async function todayFrame(page: Page): Promise<Frame> {
  await expect(page.locator(UNIVERSAL)).toBeVisible();
  const frame = await (await page.locator(`${UNIVERSAL} iframe`).elementHandle())?.contentFrame();
  if (!frame) throw new Error("no universal frame");
  await expect(frame.locator(".desk-universal-page-title")).toHaveText("Today");
  return frame;
}

/** Run desk.today.open as the desk does, and resolve with the frame. */
async function openToday(page: Page): Promise<Frame> {
  await page.evaluate(() => window.__desk.runtime.commands.run("desk.today.open"));
  return todayFrame(page);
}

const SECTIONS = ".desk-universal-page > desk-universal-view";
const section = (frame: Frame, title: string) =>
  frame.locator(SECTIONS).filter({ has: frame.locator("h2.title", { hasText: title }) });
const titles = (frame: Frame, name: string) => section(frame, name).locator(".entry-title");

test.describe("desk.today", () => {
  test("today shows the day's events, the tasks due, unread messages and the notes touched last", async ({
    page,
  }) => {
    await load(page);
    const frame = await openToday(page);
    await expect(frame.locator(`${SECTIONS} h2.title`)).toHaveText([
      "Schedule",
      "Due",
      "Unread",
      "Last touched",
      "GitHub",
    ]);
    for (const view of await frame.locator(SECTIONS).all())
      await expect(view).toHaveAttribute("state", "ready");
    const types = await frame
      .locator(SECTIONS)
      .evaluateAll((els) =>
        els.map((el) => (el as unknown as { view: { type: string } }).view.type),
      );
    expect(types).toEqual(["calendar", "list", "list", "list", "list"]);
    await expect(titles(frame, "Schedule")).toHaveText([
      "Team standup",
      "Lunch with Mina",
      "Design review",
    ]);
    // Only open tasks due by tonight, earliest first; only unread messages, newest first.
    await expect(titles(frame, "Due")).toHaveText(["Send the weekly report"]);
    await expect(titles(frame, "Unread")).toHaveText(["Lunch today?", "Boiler check on Monday"]);
    await expect(titles(frame, "Last touched")).toHaveText([
      "Ideas for the offsite",
      "Kimchi stew",
    ]);
    // GitHub is optional: with no desk.github connected its section says there is no work.
    await expect(section(frame, "GitHub")).toContainText("No open GitHub work.");
    expect(await viewTree(frame)).toMatchSnapshot("today-full.json");
  });

  test("each section draws its empty text when nothing matches", async ({ page }) => {
    await load(page, "?empty=1");
    const frame = await openToday(page);
    await expect(frame.locator(SECTIONS)).toHaveCount(5);
    await expect(frame.locator(`${SECTIONS} .status[data-state="empty"]`)).toHaveText([
      "Nothing on the calendar.",
      "Nothing due.",
      "No unread messages.",
      "No notes yet.",
      "No open GitHub work.",
    ]);
    expect(await viewTree(frame)).toMatchSnapshot("today-empty.json");
  });

  test("with no task source the page still renders, and Due says nothing is due", async ({
    page,
  }) => {
    await load(page, "?resources=event,message,note");
    const frame = await openToday(page);
    await expect(section(frame, "Due")).toContainText("Nothing due.");
    for (const title of ["Schedule", "Unread", "Last touched"])
      await expect(titles(frame, title).first()).toBeVisible();
    // A page reads every source of its kinds: nobody is asked to pick one.
    await expect(page.locator(PALETTE)).toBeHidden();
    const picks = await page.evaluate(() =>
      window.__desk.stub.log.filter(
        (e) =>
          e.request.method === "cmd.invoke" &&
          (e.request.params as { id?: string }).id === "desk.palette.pick",
      ),
    );
    expect(picks).toEqual([]);
    expect(await viewTree(frame)).toMatchSnapshot("today-no-tasks.json");
  });

  test("with GitHub connected, its open work fills the GitHub section and its milestones are due", async ({
    page,
  }) => {
    await load(page, "?github=1&resources=event,message,note");
    const frame = await openToday(page);
    // Open work, the last updated first, each with its repository.
    await expect(titles(frame, "GitHub")).toHaveText([
      "Today shows GitHub work",
      "Stage the updater's rollout",
      "Calendar drops all-day events",
      "Write the release notes for 0.1",
      "Sketch the arc keyboard layout",
    ]);
    await expect(section(frame, "GitHub").locator(".entry-detail").first()).toHaveText(
      "acme/garage",
    );
    // The only task source is GitHub, so Due reads it too: the work its milestone makes due today.
    await expect(titles(frame, "Due")).toHaveCount(2);
    await expect(section(frame, "Due")).toContainText("Calendar drops all-day events");
    await expect(section(frame, "Due")).toContainText("Today shows GitHub work");
  });

  test("Mod+T opens today, and the palette lists Open today with its key", async ({ page }) => {
    await load(page);
    await page.keyboard.press("Control+T");
    const frame = await todayFrame(page);
    await expect(section(frame, "Schedule")).toHaveAttribute("state", "ready");
    await page.keyboard.press("Escape");
    await expect(page.locator(UNIVERSAL)).toBeHidden();

    await page.keyboard.press("Control+K");
    await expect(page.locator(PALETTE)).toBeVisible();
    const palette = page.frameLocator(`${PALETTE} iframe`);
    await expect(palette.getByTestId("query")).toBeFocused();
    await page.keyboard.type("today");
    const options = palette.getByRole("option");
    const open = options.filter({ hasText: "Open today" });
    await expect(open).toHaveCount(1);
    await expect(open).toContainText("Ctrl+T");
    const labels = await options.allTextContents();
    const at = labels.findIndex((label) => label.includes("Open today"));
    for (let i = 0; i < at; i++) await page.keyboard.press("ArrowDown");
    await expect(open).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page.locator(PALETTE)).toBeHidden();
    await todayFrame(page);
  });

  test("the page shows its way out: Close at the top right, and a press beside the sections", async ({
    page,
  }) => {
    await load(page);
    let frame = await openToday(page);
    const close = frame.getByRole("button", { name: "Close (Escape)" });
    await expect(close).toBeVisible();
    await expect(close.locator("kbd")).toHaveText("Esc");
    // In sight: at the overlay's top right, above the page's title.
    const shown = await page.locator(UNIVERSAL).boundingBox();
    const box = await close.boundingBox();
    const title = await frame.locator(".desk-universal-page-title").boundingBox();
    if (!shown || !box || !title) throw new Error("no boxes");
    expect(box.y + box.height).toBeLessThanOrEqual(title.y);
    expect(box.x).toBeGreaterThan(shown.x + shown.width / 2);
    expect(box.x + box.width).toBeLessThanOrEqual(shown.x + shown.width);
    await close.click();
    await expect(page.locator(UNIVERSAL)).toBeHidden();

    frame = await openToday(page);
    await frame.locator("#root").click({ position: { x: 24, y: 24 } });
    await expect(page.locator(UNIVERSAL)).toBeHidden();
  });

  test("Next on the Schedule shows the next day's events; Today brings today's back", async ({
    page,
  }) => {
    await load(page);
    const frame = await openToday(page);
    const schedule = section(frame, "Schedule");
    await expect(titles(frame, "Schedule")).toHaveCount(3);
    await schedule.locator('[data-go="next"]').click();
    await expect(schedule.locator(".calendar-view .title")).toHaveText("Sat, Oct 31");
    await expect(titles(frame, "Schedule")).toHaveText(["Hike at Bukhansan"]);
    await schedule.locator('[data-go="today"]').click();
    await expect(titles(frame, "Schedule")).toHaveText([
      "Team standup",
      "Lunch with Mina",
      "Design review",
    ]);
  });
});
