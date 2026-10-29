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

/** Move the clock by `ms`, rounded to whole frames. */
export const run = (page: Page, ms: number) =>
  page.clock.runFor(Math.max(FRAME, Math.round(ms / FRAME) * FRAME));

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

/** From the sign-in scene: open the browser and pick the stub's outcome. */
export async function signIn(page: Page, frame: Frame, outcome: string) {
  await untilScene(page, frame, "sign-in");
  await until(page, frame.getByRole("button", { name: "Sign in with endue ID" }));
  await frame.getByRole("button", { name: "Sign in with endue ID" }).click();
  await frame.getByRole("button", { name: outcome }).click();
}

export const stored = (page: Page, key: string) =>
  page.evaluate((k) => window.__deskStore[k], key) as Promise<Record<string, unknown> | undefined>;
