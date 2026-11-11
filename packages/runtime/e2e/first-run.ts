import { expect, type Frame, type Locator, type Page } from "@playwright/test";

// Helpers for the first-run tests. Every animation runs on the page's clock; Playwright's fake clock
// replaces it in every frame. The clock is paused at 1 s before the page loads, so the first-run
// timeline starts at a known time.
//
// The plugin frame's animation frames fall on a 16 ms grid of its own performance.now(), whose zero
// lies a few real milliseconds before the pause: Playwright replays its clock calls in every document
// a page loads later, and counts the real time between `install` and `pauseAt` in. That is 0-2 ms
// here and up to 60 ms under four workers. A runFor that ends between two grid points therefore takes
// in one frame more on a slow machine than on a fast one, and every animated value in a snapshot
// shifts by 16 ms (#27). So `open` steps to the timeline's first frame, and `run` only ever moves the
// clock by whole frames. A frame asked for on a grid point comes on the next one, not on that one:
// when the real time counted in is a whole number of frames (0 ms, most often), the first frame is
// still a whole frame away (#75).

const FRAME = 16;

const frames = (ms: number) => Math.max(FRAME, Math.round(ms / FRAME) * FRAME);

/** Move the clock by `ms`, rounded to whole frames. */
export const run = (page: Page, ms: number) => page.clock.runFor(frames(ms));

/**
 * Jump the clock by `ms`, rounded to whole frames, as if the lid was closed: every due timer and
 * animation frame fires once, at the end, and the timeline runs all its due cues on that one frame.
 * `run` renders all 62 frames of each second, which is most of a long test's time (#569). Only for
 * waits whose in-between frames nothing reads; snapshots and lines that follow a cue step with `run`.
 */
export const skip = (page: Page, ms: number) => page.clock.fastForward(frames(ms));

export async function open(page: Page, query = ""): Promise<Frame> {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  await page.goto(`/onboarding.html${query}`);
  await page.waitForFunction(() => window.__desk !== undefined);
  const handle = await page.waitForSelector('[data-surface="endue.onboarding"] iframe');
  const frame = await handle.contentFrame();
  if (!frame) throw new Error("no onboarding frame");
  await frame.waitForFunction(() => document.documentElement.dataset.scene !== undefined);
  const offGrid = (await frame.evaluate(() => performance.now())) % FRAME;
  await page.clock.runFor(FRAME - offGrid);
  return frame;
}

export const scene = (frame: Frame) => frame.evaluate(() => document.documentElement.dataset.scene);

export async function untilScene(page: Page, frame: Frame, name: string, step = 512) {
  for (let i = 0; i < 160 && (await scene(frame)) !== name; i++) await run(page, step);
  expect(await scene(frame)).toBe(name);
}

/** Run the clock until `locator` shows (controls appear on the timeline, not at once). */
export async function until(page: Page, locator: Locator, step = 256) {
  for (let i = 0; i < 160 && !(await locator.isVisible()); i++) await run(page, step);
  await expect(locator).toBeVisible();
}

/** Run the clock until the live region has said `text`. */
export async function untilSaid(page: Page, frame: Frame, text: string, step = 256) {
  const said = () => frame.locator("#live").textContent();
  for (let i = 0; i < 200 && !(await said())?.includes(text); i++) await run(page, step);
  await expect(frame.locator("#live")).toContainText(text);
}

/**
 * Type `text` into the field labelled `label` and press Enter. The plugin SDK fires the form's submit
 * a timer of 0 ms later (forms.ts: the frame's sandbox has no allow-forms), on the paused page clock:
 * a run of 0 ms fires it now, at the time the answer was given.
 */
export async function answer(page: Page, frame: Frame, label: string, text: string) {
  const input = frame.getByLabel(label);
  await until(page, input);
  await input.fill(text);
  await input.press("Enter");
  await page.clock.runFor(0);
}

/** The brain.say calls the stub brain has had. */
export const brainCalls = (page: Page) =>
  page.evaluate(
    () => window.__desk.stub.log.filter((entry) => entry.request.method === "brain.say").length,
  );

/** Scene 3's answers along the edge. */
export const USE_MIC = "Use my microphone";
export const NOT_NOW = "Not now";

/**
 * From before the microphone scene: wait for Eris's question and give `choice`. A yes is asked of
 * the desk, whose answer comes over the bridge in real time; the scene goes on from the time of the
 * press, so the clock stays put until the answer is in.
 */
export async function answerMicrophone(page: Page, frame: Frame, choice = USE_MIC) {
  await untilScene(page, frame, "microphone");
  const button = frame.getByRole("button", { name: choice });
  await until(page, button);
  await button.click();
  await expect(frame.locator("html")).toHaveAttribute("data-microphone", /^(on|off)$/);
}

/** From before the microphone scene: allow the microphone, then give the name. */
export async function submitName(page: Page, frame: Frame, name: string) {
  await answerMicrophone(page, frame);
  await untilScene(page, frame, "name");
  await answer(page, frame, "Type your name", name);
}

/** The code the onboarding fixture's account.signIn hands out. */
export const CODE = "WDJB-MJHT";

/** Report an account change as the core would: addressed to the holders of account:manage. */
export const accountChanged = (page: Page, data: Record<string, unknown>) =>
  page.evaluate((data) => {
    const event = { event: "account.changed", data, to: ["desk", "endue.onboarding"] };
    window.__desk.stub.emit(event as never);
  }, data);

/** The person finished in the browser: signed in as Ada Lovelace. */
export const approve = (page: Page) =>
  accountChanged(page, {
    state: "signed-in",
    profile: { displayName: "Ada Lovelace", email: "ada@example.com" },
  });

/** The sign-in ended without a session, for `reason`. */
export const fail = (page: Page, reason: string) =>
  accountChanged(page, { state: "signed-out", problem: "The core's sentence.", reason });

/**
 * From the sign-in scene: press `button` on the entry and wait for the code to confirm. The code comes
 * with account.signIn's answer, over the bridge in real time, and Eris moves up from the moment it
 * arrives: the clock stays put until then, or the move would start wherever the clock had got to.
 */
export async function startSignIn(page: Page, frame: Frame, button = "Sign in with endue ID") {
  await untilScene(page, frame, "sign-in");
  const entry = frame.getByRole("button", { name: button });
  await until(page, entry);
  await entry.click();
  await expect(frame.getByText(CODE)).toBeVisible();
}

/** From the sign-in scene: sign in (or create an account) and finish in the "browser". */
export async function signIn(page: Page, frame: Frame, button = "Sign in with endue ID") {
  await startSignIn(page, frame, button);
  await approve(page);
}

/** The account.* calls the first run made, with their params. */
export const accountCalls = (page: Page) =>
  page.evaluate(() =>
    window.__desk.stub.log
      .filter((e) => e.request.method.startsWith("account."))
      .map((e) => ({ caller: e.caller, method: e.request.method, params: e.request.params })),
  );

export const stored = (page: Page, key: string) =>
  page.evaluate((k) => window.__deskStore[k], key) as Promise<Record<string, unknown> | undefined>;
