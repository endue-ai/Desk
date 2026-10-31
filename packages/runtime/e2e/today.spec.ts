import { expect, type Frame, type Page, test } from "@playwright/test";
import { viewTree } from "./view-tree";

// desk.today (plugins/today) drawn by desk.views on the browser stub's fixture items (views.html),
// at the stub's clock: Friday 30 October 2026, 9 in the morning in Seoul.
const VIEWS = '[data-surface="desk.views"]';
const PALETTE = '[data-surface="desk.palette"]';

test.use({ timezoneId: "Asia/Seoul", locale: "en-US" });

async function load(page: Page, query = ""): Promise<void> {
  await page.clock.setFixedTime("2026-10-30T09:00:00+09:00");
  await page.goto(`/views.html${query}`);
  await page.waitForFunction(() => window.__views !== undefined);
  await page.evaluate(() => window.__views.ready);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  for (const id of ["desk.views.open", "desk.today.open", "desk.palette.open"])
    await expect
      .poll(() => page.evaluate((c) => window.__desk.runtime.commands.has(c), id))
      .toBe(true);
}

/** The views frame, once its overlay shows. */
async function views(page: Page): Promise<Frame> {
  await expect(page.locator(VIEWS)).toBeVisible();
  const frame = await (await page.locator(`${VIEWS} iframe`).elementHandle())?.contentFrame();
  if (!frame) throw new Error("no views frame");
  return frame;
}

/** Run desk.today.open as the desk does, and resolve with the views frame. */
async function openToday(page: Page): Promise<Frame> {
  await page.evaluate(() => window.__desk.runtime.commands.run("desk.today.open"));
  const frame = await views(page);
  await expect(frame.locator("#view-title")).toHaveText("Today");
  return frame;
}

const section = (frame: Frame, title: string) =>
  frame.locator("section.component").filter({ has: frame.locator("h2", { hasText: title }) });

test.describe("desk.today", () => {
  test("today shows the day's events, the tasks due, unread messages and the notes touched last", async ({
    page,
  }) => {
    await load(page);
    const frame = await openToday(page);
    await expect(frame.locator("section.component h2")).toHaveText([
      "Schedule",
      "Due",
      "Unread",
      "Last touched",
    ]);
    const schedule = section(frame, "Schedule");
    await expect(schedule).toHaveAttribute("data-component", "agenda");
    for (const title of ["Schedule", "Due", "Unread", "Last touched"])
      await expect(section(frame, title)).toHaveAttribute("data-state", "ready");
    await expect(schedule.getByRole("option")).toHaveText([
      /Team standup/,
      /Lunch with Mina/,
      /Design review/,
    ]);
    // Only open tasks due by tonight, earliest first; only unread messages.
    await expect(section(frame, "Due").getByRole("option")).toHaveText([/Send the weekly report/]);
    await expect(section(frame, "Unread").getByRole("option")).toHaveText([
      /Lunch today\?/,
      /Boiler check on Monday/,
    ]);
    await expect(section(frame, "Last touched").getByRole("option")).toHaveText([
      /Ideas for the offsite/,
      /Kimchi stew/,
    ]);
    expect(await viewTree(frame)).toMatchSnapshot("today-full.json");
  });

  test("each section draws its empty text when nothing matches", async ({ page }) => {
    await load(page, "?empty=1");
    const frame = await openToday(page);
    const components = frame.locator("[data-component]");
    await expect(components).toHaveCount(4);
    for (const component of await components.all())
      await expect(component).toHaveAttribute("data-state", "empty");
    await expect(frame.locator("[data-component] p.empty")).toHaveText([
      "Nothing on the calendar today.",
      "Nothing due.",
      "No unread messages.",
      "No notes yet.",
    ]);
    expect(await viewTree(frame)).toMatchSnapshot("today-empty.json");
  });

  test("with no task source the view still renders, and Due offers to connect one", async ({
    page,
  }) => {
    await load(page, "?resources=event,message,note");
    const frame = await openToday(page);
    const due = section(frame, "Due");
    await expect(due).toHaveAttribute("data-state", "unbound");
    await expect(due.getByRole("button", { name: "Connect a source" })).toBeVisible();
    for (const title of ["Schedule", "Unread", "Last touched"])
      await expect(section(frame, title)).toHaveAttribute("data-state", "ready");
    // One candidate for each require that has any: nobody was asked to pick.
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

  test("Mod+T opens today, and the palette lists Open today with its key", async ({ page }) => {
    await load(page);
    await page.keyboard.press("Control+T");
    const frame = await views(page);
    await expect(frame.locator("#view-title")).toHaveText("Today");
    await expect(section(frame, "Schedule")).toHaveAttribute("data-state", "ready");
    await page.keyboard.press("Escape");
    await expect(page.locator(VIEWS)).toBeHidden();

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
    const again = await views(page);
    await expect(again.locator("#view-title")).toHaveText("Today");
  });
});
