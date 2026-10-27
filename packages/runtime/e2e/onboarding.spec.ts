import { expect, type Frame, type Page, test } from "@playwright/test";
import { frameTree } from "./frame-tree";

// Every animation runs on the page's clock; Playwright's fake clock replaces it in every frame.
// The clock is paused at 1 s before the page loads, so the first-run timeline starts at a known time.

async function open(page: Page, query = ""): Promise<Frame> {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  await page.goto(`/onboarding.html${query}`);
  await page.waitForFunction(() => window.__desk !== undefined);
  const frame = await waitForFrame(page);
  await frame.waitForFunction(() => document.documentElement.dataset.scene !== undefined);
  return frame;
}

async function waitForFrame(page: Page): Promise<Frame> {
  const handle = await page.waitForSelector('[data-surface="endue.onboarding"] iframe');
  const frame = await handle.contentFrame();
  if (!frame) throw new Error("no onboarding frame");
  return frame;
}

const scene = (frame: Frame) => frame.evaluate(() => document.documentElement.dataset.scene);

async function untilScene(page: Page, frame: Frame, name: string) {
  for (let i = 0; i < 80 && (await scene(frame)) !== name; i++) await page.clock.runFor(500);
  expect(await scene(frame)).toBe(name);
}

async function submitName(page: Page, frame: Frame, name: string) {
  await untilScene(page, frame, "name");
  const input = frame.getByLabel("Type your name");
  for (let i = 0; i < 20 && !(await input.isVisible()); i++) await page.clock.runFor(250);
  await input.fill(name);
  await input.press("Enter");
}

test.describe("first run, scenes 1-5", () => {
  test("arrival at 3.0 s", async ({ page }) => {
    const frame = await open(page);
    await page.clock.runFor(3000);
    expect(await frameTree(frame)).toMatchSnapshot("first-run-3000ms.json");
  });

  test("first greeting at 8.8 s", async ({ page }) => {
    const frame = await open(page);
    await page.clock.runFor(8800);
    expect(await frameTree(frame)).toMatchSnapshot("first-run-8800ms.json");
  });

  test("microphone question at 19.3 s", async ({ page }) => {
    const frame = await open(page);
    await page.clock.runFor(19300);
    expect(await frameTree(frame)).toMatchSnapshot("first-run-19300ms.json");
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
      window.__desk.stub.log.filter((e) => e.request.method === "perm.request").map((e) => e.caller),
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
    ["Failure", "Sign-in didn't go through. The link may have expired. Open it again?"],
  ] as const) {
    test(`sign-in stub: ${choice}`, async ({ page }) => {
      const frame = await open(page);
      await submitName(page, frame, "Ada");
      await untilScene(page, frame, "sign-in");
      await frame.getByRole("button", { name: "Sign in with endue ID" }).click();
      await frame.getByRole("button", { name: choice }).click();
      await page.clock.runFor(500);
      await expect(frame.locator("#live")).toContainText(line);
      if (choice === "Failure") {
        await expect(frame.getByRole("button", { name: "Open it again" })).toBeVisible();
      } else {
        const stored = await page.evaluate(() => window.__deskStore["first-run"]);
        expect(stored).toEqual({ done: true, name: "Ada" });
      }
    });
  }

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
    await page.clock.runFor(10000);
    const live = frame.locator("#live");
    await expect(live).toHaveAttribute("aria-live", "polite");
    await expect(live).toContainText("Endue's Ridiculously Impressive Secretary.");
  });
});
