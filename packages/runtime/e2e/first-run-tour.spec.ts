import { expect, type Frame, type Page, test } from "@playwright/test";
import {
  answer,
  open,
  run,
  scene,
  signIn,
  stored,
  submitName,
  until,
  untilSaid,
  untilScene,
} from "./first-run";
import { frameTree } from "./frame-tree";

// Scenes 6-10 of the first run: the desk switches on, the agents join, the first task builds a
// screen, the layout is saved, and Eris settles into the left bar. ?resume=<scene> starts a first run
// that was interrupted there, which keeps these tests short.

async function pickTask(page: Page, frame: Frame, text: string) {
  await untilScene(page, frame, "task");
  await until(page, frame.getByRole("button", { name: text }));
  await frame.getByRole("button", { name: text }).click();
}

test.describe("first run, scenes 6-10", () => {
  test("the whole tour after Skip intro, with the calendar connected", async ({ page }) => {
    test.setTimeout(120_000);
    const frame = await open(page);
    await run(page, 1200);
    await frame.getByRole("button", { name: "Skip intro" }).click();
    await signIn(page, frame, "Success");

    // Scene 6: the frame switches on, then the cards; a chosen card connects.
    await untilScene(page, frame, "desk");
    await untilSaid(page, frame, "This is your desk. Nothing here is fixed.");
    const calendar = frame.getByRole("button", { name: "Calendar" });
    await until(page, calendar);
    await expect(frame.locator("#frame .mode")).toHaveText("endue");
    await expect(frame.locator("#frame .desktops span")).toHaveText(["1", "2", "3"]);
    await calendar.click();
    await expect(calendar).toHaveAttribute("aria-pressed", "true");
    await run(page, 1000);
    await expect(frame.locator('#frame .toolbar [data-source="calendar"]')).toHaveText("Calendar");
    await frame.getByRole("button", { name: "Done" }).click();
    await untilSaid(page, frame, "That's all I'll look at. You can change it anytime.");

    // Scene 7: Tin speaks from the calendar, then Seed; Muse waits dim.
    await untilScene(page, frame, "agents");
    await untilSaid(page, frame, "Tin: Tin here. Two of tomorrow's meetings overlap.");
    await untilSaid(page, frame, "Seed: Seed. Give me a question you keep putting off.");
    await untilSaid(page, frame, "One more is waiting. You can meet Muse later.");
    await expect(frame.locator('#frame [data-agent="muse"]')).toHaveClass(/dim/);

    // Skip intro left the microphone and the name for the first conversation.
    await untilScene(page, frame, "microphone");
    await submitName(page, frame, "Ada");

    // Scene 8: the screen did not exist a second ago; the overlap gets a heads-up.
    await pickTask(page, frame, "What's on tomorrow?");
    await untilSaid(page, frame, "This screen didn't exist a second ago. I built it for you.");
    await expect(frame.locator("#canvas .schedule li")).toHaveCount(4);
    await untilSaid(page, frame, "Small bit of discord: 10:00 and 10:30 overlap. Move one?");
    const move = frame.getByRole("button", { name: "Move 10:30" });
    await until(page, move);
    await move.click();
    await expect(frame.locator('#canvas [data-title="Call with Sam"] time')).toHaveText(
      "11:00-11:30",
    );

    // Scene 9: the layout is named, kept in the endue mode and folded into the dock.
    await untilScene(page, frame, "layout");
    await answer(page, frame, "Name this layout", "Morning.");
    await untilSaid(page, frame, 'Saved. Say "Morning" and it comes back.');
    await run(page, 1500);
    await expect(frame.locator("#frame .dock .saved")).toHaveText("Morning");
    expect(await stored(page, "layouts")).toEqual({
      endue: [{ name: "Morning", screen: "tomorrow", text: "What's on tomorrow?" }],
    });

    // Scene 10: Eris moves into her slot; "Hey Eris" stays, then the overlay closes.
    await untilScene(page, frame, "outro");
    await untilSaid(page, frame, "That's the tour. I'll be right up here.");
    await untilSaid(page, frame, 'Say "Hey Eris" anytime.');
    for (let i = 0; i < 40; i++) {
      if ((await stored(page, "first-run"))?.done) break;
      await run(page, 500);
    }
    expect(await stored(page, "first-run")).toMatchObject({
      done: true,
      name: "Ada",
      connections: ["calendar"],
      skipped: true,
    });
    await run(page, 1500);
    await expect(page.locator('[data-surface="endue.onboarding"]')).toHaveCount(0);
  });

  test("with nothing connected, Tin asks for a calendar and only Plan my week is offered", async ({
    page,
  }) => {
    const frame = await open(page, "?resume=agents&name=Ada");
    await untilSaid(page, frame, "Where were we? Right, your desk.");
    await expect(frame.locator("#frame .mode")).toHaveText("endue");
    await untilSaid(page, frame, "Tin: Tin here. Connect a calendar and I'll keep it tidy.");
    await untilScene(page, frame, "task");
    await until(page, frame.getByRole("button", { name: "Plan my week" }));
    await expect(frame.locator("#edge button")).toHaveText(["Plan my week"]);
    await frame.getByRole("button", { name: "Plan my week" }).click();
    await untilSaid(page, frame, "This screen didn't exist a second ago.");
    await expect(frame.locator("#canvas .week .day")).toHaveCount(7);
    await untilScene(page, frame, "layout");
  });

  test("Later during the agents: they wait at the edge", async ({ page }) => {
    const frame = await open(page, "?resume=agents&name=Ada");
    await untilScene(page, frame, "agents");
    await frame.getByRole("button", { name: "Later" }).click();
    await untilSaid(page, frame, "They'll wait at the edge.");
    await expect(frame.locator("#frame .agent")).toHaveCount(3);
    await untilScene(page, frame, "task");
  });

  test("anything else goes to the brain, and its answer fills the panel", async ({ page }) => {
    const frame = await open(page, "?resume=task&name=Ada");
    await untilScene(page, frame, "task");
    await answer(page, frame, "Type a task", "find a quiet hour");
    await run(page, 3000);
    await expect(frame.locator("#canvas .answer h2")).toHaveText("find a quiet hour");
    await expect(frame.locator("#canvas .answer .body")).toHaveText("find a quiet hour");
    const said = await page.evaluate(() =>
      window.__desk.stub.log
        .filter((entry) => entry.request.method === "brain.say")
        .map((entry) => entry.caller),
    );
    expect(said).toEqual(["endue.onboarding"]);
  });

  test("the first screen, 3.5 s after the task", async ({ page }) => {
    const frame = await open(page, "?resume=task&name=Ada&connect=calendar");
    await pickTask(page, frame, "What's on tomorrow?");
    await run(page, 3500);
    expect(await frameTree(frame)).toMatchSnapshot("first-screen-plus-3500ms.json");
  });

  test("a first run quit while naming the layout asks for a task again", async ({ page }) => {
    const frame = await open(page, "?resume=task&name=Ada");
    await pickTask(page, frame, "Plan my week");
    await untilScene(page, frame, "layout");
    expect(await stored(page, "first-run")).toMatchObject({ done: false, scene: "task" });
    expect(await scene(frame)).toBe("layout");
  });
});
