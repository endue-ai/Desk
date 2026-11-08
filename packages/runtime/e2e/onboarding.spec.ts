import { expect, test } from "@playwright/test";
import {
  accountCalls,
  accountChanged,
  approve,
  CODE,
  fail,
  open,
  run,
  scene,
  skip,
  startSignIn,
  stored,
  submitName,
  until,
  untilSaid,
  untilScene,
} from "./first-run";
import { frameTree } from "./frame-tree";

// Scenes 1-5 of the first run and their branches; scenes 6-10 are in first-run-tour.spec.ts. Scene 5
// signs in with endue ID (ADR 0111) over the fixture's account.*, which tests drive with the
// account.changed events the core would send.

const ACCOUNT = { permission: "account:manage" };

// `run` renders every frame: about 0.4 s of real time per second of first-run time in the e2e
// container. The tests that walk the arrival and the name scene, and most of them on into sign-in,
// let 37-60 s of first-run time pass and take 15-21 s, too close to Playwright's 30 s; they get about
// twice that (#569).
const LONG_RUN = 45_000;

test.describe("first run, scenes 1-5", () => {
  test("arrival: the count at 3.0 s", async ({ page }) => {
    const frame = await open(page);
    await run(page, 3000);
    expect(await frameTree(frame)).toMatchSnapshot("first-run-3000ms.json");
  });

  test("arrival: the polygons lock in at 6.8 s", async ({ page }) => {
    const frame = await open(page);
    await run(page, 6800);
    expect(await frameTree(frame)).toMatchSnapshot("first-run-6800ms.json");
  });

  test("first greeting at 13.8 s", async ({ page }) => {
    const frame = await open(page);
    await run(page, 13800);
    expect(await scene(frame)).toBe("greeting");
    expect(await frameTree(frame)).toMatchSnapshot("first-run-13800ms.json");
  });

  test("microphone question at 24.3 s", async ({ page }) => {
    const frame = await open(page);
    await run(page, 24300);
    expect(await frameTree(frame)).toMatchSnapshot("first-run-24300ms.json");
  });

  test("2.4 s after the name is submitted", async ({ page }) => {
    const frame = await open(page);
    await submitName(page, frame, "Ada");
    await run(page, 2400);
    expect(await frameTree(frame)).toMatchSnapshot("name-plus-2400ms.json");
  });

  test("Skip intro jumps to sign-in", async ({ page }) => {
    const frame = await open(page);
    await run(page, 1200);
    await frame.getByRole("button", { name: "Skip intro" }).click();
    await run(page, 2000);
    expect(await scene(frame)).toBe("sign-in");
    await expect(frame.locator("#live")).toContainText("Fine. I'll be brief.");
    expect(await frameTree(frame)).toMatchSnapshot("skip-plus-2000ms.json");
  });

  test("reduced motion uses short fades", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const frame = await open(page);
    await run(page, 3200);
    expect(await frameTree(frame)).toMatchSnapshot("reduced-motion-3200ms.json");
  });
});

test.describe("branches", () => {
  test("Skip intro appears after 1 s", async ({ page }) => {
    const frame = await open(page);
    const skip = frame.getByRole("button", { name: "Skip intro" });
    await expect(skip).toBeHidden();
    await run(page, 1100);
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
    await run(page, 500);
    await expect(frame.locator("#live")).toContainText("Didn't catch that. One more time?");
    await expect(frame.getByLabel("Type your name")).toBeVisible();
  });

  test("sign-in: the entry offers Sign in, Create account and Skip, like endue.ai's", async ({
    page,
  }) => {
    test.setTimeout(LONG_RUN);
    const frame = await open(page);
    await submitName(page, frame, "Ada");
    await untilScene(page, frame, "sign-in");
    const entry = frame.getByRole("group", { name: "A little more you. A lot more possible." });
    await until(page, entry);
    await expect(entry).toContainText("Your own AI, a world of possibility");
    await expect(entry).toContainText(
      "Meet your AI. Give it character, connect your tools, and make things happen.",
    );
    await expect(entry).toContainText("Start free. No card required.");
    await expect(entry.getByRole("button")).toHaveText(["Sign in with endue ID", "Create account"]);
    await expect(frame.getByRole("button", { name: "Skip for now" })).toBeVisible();
    await run(page, 1000);
    expect(await frameTree(frame)).toMatchSnapshot("sign-in-entry.json");
  });

  for (const [button, screen, line] of [
    ["Sign in with endue ID", "sign-in", "Got it. Welcome in."],
    ["Create account", "sign-up", "A fresh account. Even better."],
  ] as const) {
    test(`sign-in: ${button} waits with the code and switches the desk on`, async ({ page }) => {
      test.setTimeout(LONG_RUN);
      const frame = await open(page);
      await submitName(page, frame, "Ada");
      await startSignIn(page, frame, button);
      await expect(frame.getByText("Confirm this code on the endue ID page.")).toBeVisible();
      await expect(frame.getByText("auth.endue.ai/realms/endue/device")).toBeVisible();
      const hint = frame.getByText("New to Endue? Create an account");
      await expect(hint).toHaveCount(screen === "sign-up" ? 1 : 0);
      expect(await accountCalls(page)).toEqual([
        { caller: "endue.onboarding", method: "account.status", params: { scope: ACCOUNT } },
        {
          caller: "endue.onboarding",
          method: "account.signIn",
          params: { scope: ACCOUNT, screen },
        },
      ]);
      await approve(page);
      await untilSaid(page, frame, line);
      await untilScene(page, frame, "desk");
      expect(await stored(page, "first-run")).toMatchObject({
        done: false,
        scene: "desk",
        name: "Ada",
        listening: true,
        local: false,
      });
    });
  }

  test("sign-in: the waiting state opens the browser again and cancels back to the entry", async ({
    page,
  }) => {
    test.setTimeout(LONG_RUN);
    const frame = await open(page);
    await submitName(page, frame, "Ada");
    await startSignIn(page, frame);
    await run(page, 1000);
    expect(await frameTree(frame)).toMatchSnapshot("sign-in-waiting.json");
    await frame.getByRole("button", { name: "Open browser again" }).click();
    await run(page, 300);
    expect((await accountCalls(page)).map((c) => c.method)).toEqual([
      "account.status",
      "account.signIn",
      "account.signIn",
    ]);
    await expect(frame.getByText(CODE)).toBeVisible();
    await accountChanged(page, {
      state: "signing-in",
      signIn: { userCode: CODE, verificationUri: "https://auth.endue.ai/realms/endue/device" },
      reason: "slow-down",
    });
    await until(page, frame.getByText("endue asked me to check less often. Still waiting."));
    await frame.getByRole("button", { name: "Cancel" }).click();
    await until(page, frame.getByRole("button", { name: "Create account" }));
    expect((await accountCalls(page)).at(-1)?.method).toBe("account.signOut");
  });

  test("sign-in: a failure offers to open it again, and help after the third", async ({ page }) => {
    test.setTimeout(LONG_RUN);
    const frame = await open(page);
    await submitName(page, frame, "Ada");
    await startSignIn(page, frame);
    await fail(page, "expired");
    await untilSaid(
      page,
      frame,
      "Sign-in didn't go through. The link may have expired. Open it again?",
    );
    const help = frame.getByText("Still stuck? Write to team@endue.ai.");
    for (let failure = 2; failure <= 3; failure++) {
      await expect(help).toBeHidden();
      await until(page, frame.getByRole("button", { name: "Open it again" }));
      await frame.getByRole("button", { name: "Open it again" }).click();
      await until(page, frame.getByText(CODE));
      await fail(page, "denied");
      await run(page, 500);
    }
    await expect(help).toBeVisible();
    await expect(frame.getByRole("button", { name: "Skip for now" })).toBeVisible();
  });

  for (const [reason, line] of [
    ["offline", "I can't reach endue right now. Check your connection"],
    ["unavailable", "endue isn't answering right now. Let's try again in a moment."],
    ["suspended", "That account is suspended. Write to team@endue.ai, or skip for now."],
  ] as const) {
    test(`sign-in: ${reason} is said and can be tried again`, async ({ page }) => {
      test.setTimeout(LONG_RUN);
      const frame = await open(page);
      await submitName(page, frame, "Ada");
      await startSignIn(page, frame);
      await fail(page, reason);
      await untilSaid(page, frame, line);
      await until(page, frame.getByRole("button", { name: "Try again" }));
    });
  }

  test("sign-in: Skip for now stays local and the desk goes on without endue's agents", async ({
    page,
  }) => {
    test.setTimeout(LONG_RUN);
    const frame = await open(page);
    await submitName(page, frame, "Ada");
    await untilScene(page, frame, "sign-in");
    const skip = frame.getByRole("button", { name: "Skip for now" });
    await until(page, skip);
    await skip.click();
    await untilSaid(page, frame, "Your desk still works here, so let's set it up.");
    await untilScene(page, frame, "desk");
    await until(page, frame.getByRole("button", { name: "Later" }));
    await frame.getByRole("button", { name: "Later" }).click();
    await untilScene(page, frame, "task");
    await expect(frame.locator("#live")).not.toContainText("Let me bring in the team.");
    expect(await stored(page, "first-run")).toMatchObject({ scene: "task", local: true });
  });

  test("sign-in: a desk already signed in goes on", async ({ page }) => {
    const frame = await open(page, "?resume=sign-in&name=Ada&account=signed-in");
    await untilSaid(page, frame, "Got it. Welcome in.");
    await untilScene(page, frame, "desk");
  });

  test("sign-in: a desk without endue ID stays local", async ({ page }) => {
    const frame = await open(page, "?resume=sign-in&name=Ada&account=none");
    await untilSaid(page, frame, "Your desk still works here, so let's set it up.");
    await untilScene(page, frame, "desk");
    expect(await stored(page, "first-run")).toMatchObject({ scene: "desk", local: true });
  });

  test("offline at sign-in: Eris says so, and the entry comes back with the connection", async ({
    page,
    context,
  }) => {
    test.setTimeout(LONG_RUN);
    const frame = await open(page);
    await submitName(page, frame, "Ada");
    await untilScene(page, frame, "sign-in");
    const button = frame.getByRole("button", { name: "Sign in with endue ID" });
    await until(page, button);
    await context.setOffline(true);
    await button.click();
    await run(page, 500);
    await expect(frame.locator("#live")).toContainText(
      "I can't reach endue right now. Check your connection, and I'll pick up where we left off.",
    );
    await expect(frame.getByText(CODE)).toBeHidden();
    await context.setOffline(false);
    await until(page, button);
    await button.click();
    await until(page, frame.getByText(CODE));
  });

  test("Eris waits patiently, once, when the browser takes 20 s", async ({ page }) => {
    test.setTimeout(LONG_RUN);
    const frame = await open(page);
    await submitName(page, frame, "Ada");
    await startSignIn(page, frame);
    // 21 s in one jump: the patience cue and the line it says run on that frame, and nothing in
    // between is read.
    await skip(page, 21000);
    await expect(frame.locator("#live")).toContainText("Take your time. I'm very patient. Mostly.");
  });

  test("8 s of silence bring one nudge to type", async ({ page }) => {
    test.setTimeout(LONG_RUN);
    const frame = await open(page);
    await untilScene(page, frame, "name");
    await run(page, 8500);
    await expect(frame.locator("#live")).toContainText("Still there? You can type, too.");
    await expect(frame.getByLabel("Type your name")).toBeFocused();
  });

  test("the second run only says good morning", async ({ page }) => {
    const frame = await open(page, "?name=Ada");
    await run(page, 2000);
    expect(await scene(frame)).toBe("welcome-back");
    await expect(frame.locator("#live")).toHaveText("Morning, Ada.");
    await expect(frame.locator("#live")).not.toContainText("Hello.");
  });

  test("Skip and the name input work from the keyboard", async ({ page }) => {
    const frame = await open(page);
    await run(page, 1200);
    await frame.locator("body").press("Tab");
    await expect(frame.getByRole("button", { name: "Skip intro" })).toBeFocused();
    await frame.getByRole("button", { name: "Skip intro" }).press("Enter");
    await run(page, 500);
    expect(await scene(frame)).toBe("sign-in");
  });

  test("screen readers get whole sentences, politely", async ({ page }) => {
    const frame = await open(page);
    await run(page, 15000);
    const live = frame.locator("#live");
    await expect(live).toHaveAttribute("aria-live", "polite");
    await expect(live).toContainText("Endue's Ridiculously Impressive Secretary.");
  });
});
