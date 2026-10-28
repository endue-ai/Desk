import { expect, test } from "@playwright/test";
import { open, scene, signIn, stored, submitName, until, untilSaid, untilScene } from "./first-run";
import { frameTree } from "./frame-tree";

// Scenes 1-5 of the first run and their branches; scenes 6-10 are in first-run-tour.spec.ts.

test.describe("first run, scenes 1-5", () => {
  test("arrival: the count at 3.0 s", async ({ page }) => {
    const frame = await open(page);
    await page.clock.runFor(3000);
    expect(await frameTree(frame)).toMatchSnapshot("first-run-3000ms.json");
  });

  test("arrival: the polygons lock in at 6.8 s", async ({ page }) => {
    const frame = await open(page);
    await page.clock.runFor(6800);
    expect(await frameTree(frame)).toMatchSnapshot("first-run-6800ms.json");
  });

  test("first greeting at 13.8 s", async ({ page }) => {
    const frame = await open(page);
    await page.clock.runFor(13800);
    expect(await scene(frame)).toBe("greeting");
    expect(await frameTree(frame)).toMatchSnapshot("first-run-13800ms.json");
  });

  test("microphone question at 24.3 s", async ({ page }) => {
    const frame = await open(page);
    await page.clock.runFor(24300);
    expect(await frameTree(frame)).toMatchSnapshot("first-run-24300ms.json");
  });

  test("2.4 s after the name is submitted", async ({ page }) => {
    const frame = await open(page);
    await submitName(page, frame, "Ada");
    await page.clock.runFor(2400);
    expect(await frameTree(frame)).toMatchSnapshot("name-plus-2400ms.json");
  });

  test("Skip intro jumps to sign-in", async ({ page }) => {
    const frame = await open(page);
    await page.clock.runFor(1200);
    await frame.getByRole("button", { name: "Skip intro" }).click();
    await page.clock.runFor(2000);
    expect(await scene(frame)).toBe("sign-in");
    await expect(frame.locator("#live")).toContainText("Fine. I'll be brief.");
    expect(await frameTree(frame)).toMatchSnapshot("skip-plus-2000ms.json");
  });

  test("reduced motion uses short fades", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const frame = await open(page);
    await page.clock.runFor(3200);
    expect(await frameTree(frame)).toMatchSnapshot("reduced-motion-3200ms.json");
  });
});

test.describe("branches", () => {
  test("Skip intro appears after 1 s", async ({ page }) => {
    const frame = await open(page);
    const skip = frame.getByRole("button", { name: "Skip intro" });
    await expect(skip).toBeHidden();
    await page.clock.runFor(1100);
    await expect(skip).toBeVisible();
  });

  test("a refused microphone switches to typing", async ({ page }) => {
    const frame = await open(page, "?mic=deny");
    await untilScene(page, frame, "name");
    await expect(frame.locator("#live")).toContainText("That's fine. Type to me instead.");
    await expect(frame.getByLabel("Type your name")).toBeVisible();
    const requests = await page.evaluate(() =>
      window.__desk.stub.log
        .filter((e) => e.request.method === "perm.request")
        .map((e) => e.caller),
    );
    expect(requests).toEqual(["endue.onboarding"]);
  });

  test("an empty name is asked for again", async ({ page }) => {
    const frame = await open(page);
    await submitName(page, frame, "   ");
    await page.clock.runFor(500);
    await expect(frame.locator("#live")).toContainText("Didn't catch that. One more time?");
    await expect(frame.getByLabel("Type your name")).toBeVisible();
  });

  for (const [choice, line] of [
    ["Success", "Got it. Welcome in."],
    ["New account", "A fresh account. Even better."],
  ] as const) {
    test(`sign-in stub: ${choice} switches the desk on`, async ({ page }) => {
      const frame = await open(page);
      await submitName(page, frame, "Ada");
      await signIn(page, frame, choice);
      await page.clock.runFor(500);
      await expect(frame.locator("#live")).toContainText(line);
      await untilScene(page, frame, "desk");
      expect(await stored(page, "first-run")).toMatchObject({
        done: false,
        scene: "desk",
        name: "Ada",
        listening: true,
      });
    });
  }

  test("sign-in stub: Failure offers to open it again, and help after the third", async ({
    page,
  }) => {
    const frame = await open(page);
    await submitName(page, frame, "Ada");
    await signIn(page, frame, "Failure");
    await page.clock.runFor(500);
    await expect(frame.locator("#live")).toContainText(
      "Sign-in didn't go through. The link may have expired. Open it again?",
    );
    const help = frame.getByText("Still stuck? Write to team@endue.ai.");
    for (let failure = 2; failure <= 3; failure++) {
      await expect(help).toBeHidden();
      await frame.getByRole("button", { name: "Open it again" }).click();
      await page.clock.runFor(500);
      await frame.getByRole("button", { name: "Failure" }).click();
      await page.clock.runFor(500);
    }
    await expect(help).toBeVisible();
  });

  test("sign-in stub: outside the US Eris says so and the desk goes on without agents", async ({
    page,
  }) => {
    const frame = await open(page);
    await submitName(page, frame, "Ada");
    await signIn(page, frame, "Outside the US");
    await untilSaid(page, frame, "endue isn't open in your region yet. It's US only for now.");
    await untilSaid(page, frame, "Your desk still works here, so let's set it up.");
    await untilScene(page, frame, "desk");
    await until(page, frame.getByRole("button", { name: "Later" }));
    await frame.getByRole("button", { name: "Later" }).click();
    await untilScene(page, frame, "task");
    await expect(frame.locator("#live")).not.toContainText("Let me bring in the team.");
    expect(await stored(page, "first-run")).toMatchObject({ scene: "task", region: false });
  });

  test("offline at sign-in: Eris says so, and the button comes back with the connection", async ({
    page,
    context,
  }) => {
    const frame = await open(page);
    await submitName(page, frame, "Ada");
    await untilScene(page, frame, "sign-in");
    const button = frame.getByRole("button", { name: "Sign in with endue ID" });
    await until(page, button);
    await context.setOffline(true);
    await button.click();
    await page.clock.runFor(500);
    await expect(frame.locator("#live")).toContainText(
      "I can't reach endue right now. Check your connection, and I'll pick up where we left off.",
    );
    await expect(frame.getByRole("button", { name: "Success" })).toBeHidden();
    await context.setOffline(false);
    await until(page, button);
    await button.click();
    await expect(frame.getByRole("button", { name: "Success" })).toBeVisible();
  });

  test("Eris waits patiently, once, when the browser takes 20 s", async ({ page }) => {
    const frame = await open(page);
    await submitName(page, frame, "Ada");
    await signIn(page, frame, "Failure");
    await until(page, frame.getByRole("button", { name: "Open it again" }));
    await frame.getByRole("button", { name: "Open it again" }).click();
    await page.clock.runFor(21000);
    await expect(frame.locator("#live")).toContainText("Take your time. I'm very patient. Mostly.");
  });

  test("8 s of silence bring one nudge to type", async ({ page }) => {
    const frame = await open(page);
    await untilScene(page, frame, "name");
    await page.clock.runFor(8500);
    await expect(frame.locator("#live")).toContainText("Still there? You can type, too.");
    await expect(frame.getByLabel("Type your name")).toBeFocused();
  });

  test("the second run only says good morning", async ({ page }) => {
    const frame = await open(page, "?name=Ada");
    await page.clock.runFor(2000);
    expect(await scene(frame)).toBe("welcome-back");
    await expect(frame.locator("#live")).toHaveText("Morning, Ada.");
    await expect(frame.locator("#live")).not.toContainText("Hello.");
  });

  test("Skip and the name input work from the keyboard", async ({ page }) => {
    const frame = await open(page);
    await page.clock.runFor(1200);
    await frame.locator("body").press("Tab");
    await expect(frame.getByRole("button", { name: "Skip intro" })).toBeFocused();
    await frame.getByRole("button", { name: "Skip intro" }).press("Enter");
    await page.clock.runFor(500);
    expect(await scene(frame)).toBe("sign-in");
  });

  test("screen readers get whole sentences, politely", async ({ page }) => {
    const frame = await open(page);
    await page.clock.runFor(15000);
    const live = frame.locator("#live");
    await expect(live).toHaveAttribute("aria-live", "polite");
    await expect(live).toContainText("Endue's Ridiculously Impressive Secretary.");
  });
});
