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

  test("a look request goes to the theme studio, and a sentence that makes a view to desk.propose, look words and all", async ({
    page,
  }) => {
    await openShell(page, "?views=1&lang=en");
    const studio = page.getByRole("dialog", { name: "Themes" });
    const LOOK = "make it feel like warm paper";
    await page.keyboard.type(LOOK);
    // The composer's last choice sends the line; the ones above it are commands it matches.
    await expect(page.getByRole("option").last()).toHaveText(`Tell Eris · ${LOOK}`);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect(studio).toBeVisible();
    await expect(studio.locator('[data-key="describe-sentence"]')).toHaveValue(LOOK);
    await expect(studio.locator(".theme-proposal")).toContainText("Warm Paper");
    await expect(page.locator(VIEWS)).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(studio).toBeHidden();

    const MADE = "make a view that looks calm: the events this week as a board";
    await page.locator("#composer-input").focus();
    await page.keyboard.type(MADE);
    await expect(page.getByRole("option").last()).toHaveText(`Make with Eris · ${MADE}`);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    const frame = await viewsFrame(page);
    await expect(frame.locator(".preview-bar")).toContainText(`Eris made this from “${MADE}”.`);
    await expect(frame.locator("#view-title")).toHaveText("Events this week");
    await expect(studio).toBeHidden();
    const asked = await page.evaluate(() =>
      window.__shell.stub.log
        .filter((entry) => entry.request.method === "brain.ask")
        .map((entry) => (entry.request.params as { tool: { name: string } }).tool.name),
    );
    expect(asked).toEqual(["propose_theme", "propose_view"]);
    await frame.locator('desk-button[data-choice="discard"]').click();
    await expect(page.locator(VIEWS)).toBeHidden();
  });
});

// Profiles and key bindings (#340) on the runtime's card, from the shell's talk line, with notes and a
// terminal stand-in installed (shell.html?apps=1) and the scripted brain's answers.
const QUIET = "make a quiet night profile with only notes and terminal";
const BIND = "bind Mod+Shift+T to open the terminal";
const active = (page: Page) =>
  page.evaluate(() => window.__shell.desk.runtime.profiles.active() ?? "");
const profileIds = (page: Page) =>
  page.evaluate(() => window.__shell.desk.runtime.profiles.list().map((p) => p.id));
/** The tools brain.ask was asked with, in order. */
const asked = (page: Page) =>
  page.evaluate(() =>
    window.__shell.stub.log
      .filter((entry) => entry.request.method === "brain.ask")
      .map((entry) => (entry.request.params as { tool: { name: string } }).tool.name),
  );
/** What Meta+Shift+T runs, as desk.keys.list says. */
const tee = (page: Page) =>
  page.evaluate(async () => {
    const list = (await window.__shell.desk.runtime.commands.run("desk.keys.list")) as Array<{
      combo: string;
      command: string;
      owner: string;
    }>;
    const found = list.find((binding) => binding.combo === "Meta+Shift+T");
    return found ? { command: found.command, owner: found.owner } : null;
  });

test.describe("desk.propose for profiles and key bindings", () => {
  test.use({ viewport: DESK });

  test("a profile from the talk line shows its ghost; Apply puts it in force; Undo switches back and removes it", async ({
    page,
  }) => {
    await openShell(page, "?views=1&apps=1&lang=en");
    await page.keyboard.type(QUIET);
    await expect(page.getByRole("option").last()).toHaveText(`Make with Eris · ${QUIET}`);
    await page.keyboard.press("Enter");
    const card = page.locator('.proposal[data-proposal="profile"]');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-state", "preview");
    await expect(card.locator(".proposal-title")).toHaveText("Quiet night");
    await expect(card.locator(".proposal-note")).toHaveText(`Eris made this from “${QUIET}”.`);
    await expect(card.locator('.ghost-desktop[data-desktop="1"] .ghost-window')).toHaveText([
      "Notes",
      "Terminal",
    ]);
    await expect(card.locator(".ghost-settings tbody td")).toHaveText([
      "desk.notify.dnd",
      "off",
      "on",
    ]);
    expect(await active(page)).toBe("morning");
    expect(await asked(page)).toEqual(["propose_profile"]);

    await card.locator('[data-choice="apply"]').click();
    await expect(card).toHaveAttribute("data-state", "applied");
    await expect(card.locator(".proposal-note")).toHaveText(
      "Eris made this profile and switched to it. Undo goes back to Morning.",
    );
    await expect.poll(() => active(page)).toBe("quiet-night");
    expect(await profileIds(page)).toContain("quiet-night");

    await card.locator('[data-action="undo"]').click();
    await expect(page.locator(".proposal")).toHaveCount(0);
    await expect.poll(() => active(page)).toBe("morning");
    expect(await profileIds(page)).not.toContain("quiet-night");
  });

  test("a key binding from the talk line shows the table with the taken key marked; Apply rebinds it; Undo puts it back", async ({
    page,
  }) => {
    await openShell(page, "?views=1&apps=1&lang=en");
    expect(await tee(page)).toEqual({ command: "endue.terminal.new", owner: "endue.terminal" });
    await page.keyboard.type(BIND);
    await expect(page.getByRole("option").last()).toHaveText(`Make with Eris · ${BIND}`);
    await page.keyboard.press("Enter");
    const card = page.locator('.proposal[data-proposal="keys"]');
    await expect(card.locator(".proposal-title")).toHaveText("⇧⌘T → Focus the terminal");
    const row = card.locator(".proposal-keys tbody tr");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-marks", "taken");
    await expect(row.locator("td")).toHaveText([
      "⇧⌘T",
      "Focus the terminal",
      "New terminal",
      "Taken from New terminal",
    ]);
    expect(await asked(page)).toEqual(["propose_key_bindings"]);

    await card.locator('[data-choice="apply"]').click();
    await expect(card).toHaveAttribute("data-state", "applied");
    await expect
      .poll(() => tee(page))
      .toEqual({ command: "endue.terminal.focus", owner: "person" });

    await card.locator('[data-action="undo"]').click();
    await expect(page.locator(".proposal")).toHaveCount(0);
    await expect
      .poll(() => tee(page))
      .toEqual({
        command: "endue.terminal.new",
        owner: "endue.terminal",
      });
  });
});
