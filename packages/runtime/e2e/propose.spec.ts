import type { BridgeRequest, View } from "@endue-ai/bridge";
import { expect, type Frame, type Page, test } from "@playwright/test";
import { DESK, openShell, step } from "./shell-helpers";
import { viewTree } from "./view-tree";

// Eris proposes a view (desk.propose, ADR 0073) with a scripted brain (src/propose/fixtures.ts): on
// the views page's fixture items (views.html?propose=1) at the stub's clock, Friday 30 October 2026,
// 9 in the morning in Seoul, and from the shell's talk line (shell.html?views=1).
const VIEWS = '[data-surface="desk.views"]';
const PALETTE = '[data-surface="desk.palette"]';
const SENTENCE = "show my events this week as a board";
const ID = "eris.events-this-week";

test.use({ timezoneId: "Asia/Seoul", locale: "en-US" });

async function load(page: Page): Promise<void> {
  await page.clock.setFixedTime("2026-10-30T09:00:00+09:00");
  await page.goto("/views.html?propose=1");
  await page.waitForFunction(() => window.__views !== undefined);
  await page.evaluate(() => window.__views.ready);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  for (const id of ["desk.propose", "desk.views.preview", "desk.palette.pick"])
    await expect
      .poll(() => page.evaluate((c) => window.__desk.runtime.commands.has(c), id))
      .toBe(true);
}

/** The views frame, once its surface shows. */
async function viewsFrame(page: Page): Promise<Frame> {
  await expect(page.locator(VIEWS)).toBeVisible();
  const frame = await (await page.locator(`${VIEWS} iframe`).elementHandle())?.contentFrame();
  if (!frame) throw new Error("no views frame");
  return frame;
}

/** The view file `id` as the core's view.get answers it, or the error code. */
const fileOf = (page: Page, which: "__desk" | "__shell", id: string) =>
  page.evaluate(
    async ([handle, viewId]) => {
      const stub = handle === "__desk" ? window.__desk.stub : window.__shell.stub;
      const request = {
        id: 0,
        method: "view.get",
        params: { id: viewId, scope: { permission: "view:manage" } },
      } as BridgeRequest;
      const answer = await stub.call(request);
      return answer.ok
        ? (answer.result as { view: View }).view
        : (answer.error as { code: string }).code;
    },
    [which, id] as const,
  );

/** What the desk itself (not a plugin) asked of one method for views Eris made (eris.*). */
const deskCalls = (page: Page, method: string) =>
  page.evaluate(
    (m) =>
      window.__desk.stub.log
        .filter((entry) => entry.caller === undefined && entry.request.method === m)
        .map((entry) => entry.request.params as { id?: string; view?: View })
        .filter((params) => (params.view?.id ?? params.id ?? "").startsWith("eris.")),
    method,
  );

test.describe("desk.propose", () => {
  test("Make with Eris… previews a view over the fixture events; Apply keeps the file and shows it with Undo; Undo removes both", async ({
    page,
  }) => {
    await load(page);
    await page.keyboard.press("Control+K");
    const palette = page.frameLocator(`${PALETTE} iframe`);
    await expect(palette.getByTestId("query")).toBeFocused();
    await page.keyboard.type("Make with Eris");
    await expect(palette.getByRole("option").first()).toContainText("Make with Eris…");
    await page.keyboard.press("Enter");
    // The command asks for the sentence in the palette's free-text pick.
    await expect(palette.getByTestId("title")).toHaveText("Make with Eris");
    await page.keyboard.type(SENTENCE);
    await page.keyboard.press("Enter");

    const frame = await viewsFrame(page);
    const bar = frame.locator(".preview-bar");
    await expect(bar).toContainText(`Eris made this from “${SENTENCE}”.`);
    await expect(frame.locator("body")).toHaveClass(/previewing/);
    await expect(frame.locator('[data-component="agenda"][data-state="ready"]')).toHaveCount(2);
    await expect(frame.getByText("10:00 Team standup")).toBeVisible();
    await expect(frame.getByText("12:30 Lunch with Mina")).toBeVisible();
    // Drawn while hidden, the frame settles its density once it shows.
    await expect(frame.locator("#root")).toHaveAttribute("data-density", "regular");
    expect(await viewTree(frame)).toMatchSnapshot("preview.json");
    // Nothing is kept before Apply.
    expect(await deskCalls(page, "view.save")).toEqual([]);
    expect(await fileOf(page, "__desk", ID)).toBe("not_found");

    await bar.locator('desk-button[data-choice="apply"]').click();
    const notice = frame.locator(".notice-bar");
    await expect(notice).toContainText(`Eris made this view: ~/.desk/views/${ID}.yaml`);
    await expect(frame.locator(".preview-bar")).toHaveCount(0);
    await expect(frame.locator("body")).not.toHaveClass(/previewing/);
    await expect(frame.locator("#view-title")).toHaveText("Events this week");
    await expect(frame.locator('[data-component="agenda"][data-state="ready"]')).toHaveCount(2);
    expect(await deskCalls(page, "view.save")).toHaveLength(1);
    expect(await fileOf(page, "__desk", ID)).toMatchObject({
      id: ID,
      version: "0.1.0",
      title: "Events this week",
      provenance: { author: "eris", words: SENTENCE, brain: "scripted" },
    });
    await expect(frame.locator("#root")).toHaveAttribute("data-density", "regular");
    expect(await viewTree(frame)).toMatchSnapshot("applied.json");

    await notice.locator("desk-button").click();
    await expect(page.locator(VIEWS)).toBeHidden();
    expect(await deskCalls(page, "view.remove")).toHaveLength(1);
    expect(await fileOf(page, "__desk", ID)).toBe("not_found");
    await expect(page.locator(".desk-status")).toContainText("Removed “Events this week”");
  });

  test("Try again sends the correction and previews the new view; Discard keeps nothing", async ({
    page,
  }) => {
    await load(page);
    const outcome = page.evaluate(
      (text) => window.__desk.runtime.commands.run("desk.propose", { kind: "view", text }),
      SENTENCE,
    );
    const frame = await viewsFrame(page);
    await expect(frame.locator("#view-title")).toHaveText("Events this week");
    await frame.locator(".correction").locator("input").fill("only the work calendar");
    await frame.locator('desk-button[data-choice="retry"]').click();
    await expect(frame.locator("#view-title")).toHaveText("Work this week");
    await expect(frame.locator(".preview-bar")).toContainText(`Eris made this from “${SENTENCE}”.`);
    await frame.locator('desk-button[data-choice="discard"]').click();
    expect(await outcome).toEqual({ status: "discarded" });
    await expect(page.locator(VIEWS)).toBeHidden();
    expect(await deskCalls(page, "view.save")).toEqual([]);
  });
});

test.describe("desk.propose from the talk line", () => {
  test.use({ viewport: DESK });

  test("/make on the talk line previews the view, and Eris says what she made after Apply", async ({
    page,
  }) => {
    await openShell(page, "?views=1&lang=en");
    await page.keyboard.type(`/make ${SENTENCE}`);
    await expect(page.getByRole("option").last()).toHaveText(`Make with Eris · /make ${SENTENCE}`);
    await page.keyboard.press("Enter");
    const frame = await viewsFrame(page);
    await expect(frame.locator(".preview-bar")).toContainText(`Eris made this from “${SENTENCE}”.`);
    await frame.locator('desk-button[data-choice="apply"]').click();
    await expect(frame.locator(".notice-bar")).toContainText(`~/.desk/views/${ID}.yaml`);
    expect(await fileOf(page, "__shell", ID)).toMatchObject({ id: ID, title: "Events this week" });
    await step(page, 3000);
    await expect(page.locator(".eris")).toHaveAttribute(
      "aria-label",
      "Eris: I made “Events this week” and saved it in your views.",
    );
    await page.evaluate(() => window.__shell.desk.runtime.commands.run("desk.propose.undo"));
    await expect(page.locator(VIEWS)).toBeHidden();
    expect(await fileOf(page, "__shell", ID)).toBe("not_found");
  });
});
