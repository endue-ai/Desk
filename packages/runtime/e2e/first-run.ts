import { expect, type Frame, type Locator, type Page } from "@playwright/test";

// Helpers for the first-run tests. Every animation runs on the page's clock; Playwright's fake clock
// replaces it in every frame. The clock is paused at 1 s before the page loads, so the first-run
// timeline starts at a known time.
//
// The plugin frame's animation frames fall on a 16 ms grid of its own performance.now(), whose zero
// lies a few real milliseconds before the pause: 1-2 ms here, more on a busy CI runner. A runFor that
// ends between two grid points therefore takes in one frame more on a slow machine than on a fast one,
// and every animated value in a snapshot shifts by 16 ms (#27). So `open` steps to the next grid point,
// where the timeline's first frame fires, and `run` only ever moves the clock by whole frames.

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
  if (offGrid !== 0) await page.clock.runFor(FRAME - offGrid);
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

export async function answer(page: Page, frame: Frame, label: string, text: string) {
  const input = frame.getByLabel(label);
  await until(page, input);
  await input.fill(text);
  await input.press("Enter");
}

export async function submitName(page: Page, frame: Frame, name: string) {
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

/** From the sign-in scene: press `button` on the entry and wait for the code to confirm. */
export async function startSignIn(page: Page, frame: Frame, button = "Sign in with endue ID") {
  await untilScene(page, frame, "sign-in");
  const entry = frame.getByRole("button", { name: button });
  await until(page, entry);
  await entry.click();
  await until(page, frame.getByText(CODE));
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
