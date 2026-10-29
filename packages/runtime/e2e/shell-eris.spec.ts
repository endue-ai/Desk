import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell, step } from "./shell-helpers";
import { shellTree } from "./shell-tree";

test.use({ viewport: DESK });

const STATES = ["idle", "listening", "thinking", "done", "heads-up", "oops"] as const;
const rings = async (page: Page) =>
  (await page.locator(".eris-mesh").getAttribute("data-rings"))?.split(" ").map(Number) ?? [];
/** Innermost and outermost ring moving more than 0.05 % of R. */
const front = (disp: number[]) => {
  const k = disp.map((d, i) => (Math.abs(d) > 0.05 ? i : -1)).filter((i) => i >= 0);
  return { inner: Math.min(...k), outer: Math.max(...k) };
};

test.beforeEach(async ({ page }) => {
  await openShell(page);
});

test("Eris switches between her six states on the same mesh", async ({ page }) => {
  const digests = new Set<string>();
  for (const state of STATES) {
    await page.evaluate((s) => window.__shell.desk.eris.setState(s), state);
    await step(page, 500);
    await expect(page.locator(".eris")).toHaveAttribute("data-state", state);
    digests.add((await page.locator(".eris-mesh").getAttribute("data-mesh")) ?? "");
    expect(await shellTree(page, ".eris")).toMatchSnapshot(`eris-${state}.json`);
  }
  expect(digests.size).toBe(STATES.length);
  await expect(page.locator(".eris-halo")).toBeHidden();
});

test("soul text (wisp) at 3.0 s, with E·R·I·S in gold and the sentence read once", async ({
  page,
}) => {
  await page.evaluate(() => window.__shell.desk.eris.say("Good morning. Eris has your day ready."));
  await step(page, 3000);
  await expect(page.locator(".soul-glyph.is-eris")).toHaveText(["E", "r", "i", "s"]);
  await expect(page.locator(".soul-live")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator(".soul-live")).toHaveText("Good morning. Eris has your day ready.");
  await expect(page.locator(".eris")).toHaveAttribute(
    "aria-label",
    "Eris: Good morning. Eris has your day ready.",
  );
  expect(await shellTree(page, ".soul")).toMatchSnapshot("soul-wisp-3000ms.json");
  // 32 glyphs: the last condenses by 1985 ms, holds 1253 ms, scatters from 3238 ms to 4838 ms.
  await step(page, 600);
  const scattering = await page
    .locator(".soul-glyph")
    .first()
    .evaluate((el) => getComputedStyle(el).filter);
  expect(scattering).toContain("blur");
  await step(page, 1300);
  await expect(page.locator(".soul-line")).toHaveCount(0);
});

test("soul text (solemn) at 3.0 s", async ({ page }) => {
  await page.evaluate(() => {
    const { desk } = window.__shell;
    desk.store.set((s) => ({ eris: { ...s.eris, soul: "solemn" } }));
    desk.eris.say("The desk is yours.");
  });
  await step(page, 3000);
  await expect(page.locator(".soul-line")).toHaveCSS("text-transform", "uppercase");
  expect(await shellTree(page, ".soul")).toMatchSnapshot("soul-solemn-3000ms.json");
});

test("listening: the user's sound flows from the rim inwards (0.4 s)", async ({ page }) => {
  await page.evaluate(() => {
    const { desk, bridge, envelopes } = window.__shell;
    desk.eris.setState("listening");
    bridge.fake.play("user", envelopes.user);
  });
  await step(page, 112);
  const early = front(await rings(page));
  await step(page, 288);
  const late = await rings(page);
  expect(early.outer).toBe(8);
  expect(front(late).inner).toBeLessThan(early.inner);
  expect(Math.max(...late)).toBeLessThanOrEqual(0);
  await expect(page.locator(".eris-mesh")).toHaveAttribute("data-voice", "listening");
  expect(await shellTree(page, ".eris")).toMatchSnapshot("listening-400ms.json");
});

test("speaking: pulses leave the core and reach the rim with each word (0.3 s)", async ({
  page,
}) => {
  await page.evaluate(() => {
    const { desk, bridge, envelopes } = window.__shell;
    bridge.fake.play("eris", envelopes.eris);
    desk.eris.say("Good morning to you.", [
      { word: "Good", at: 0 },
      { word: "morning", at: 200 },
      { word: "to", at: 420 },
      { word: "you.", at: 640 },
    ]);
  });
  await step(page, 48);
  const early = front(await rings(page));
  await step(page, 176);
  const reached = await rings(page);
  expect(early.outer).toBeLessThan(4);
  expect(reached[8]).toBeGreaterThan(0);
  // The first glyph appears when the first pulse reaches the rim (220 ms).
  await expect(page.locator(".soul-glyph").first()).not.toHaveCSS("opacity", "0");
  await step(page, 76);
  await expect(page.locator(".eris-mesh")).toHaveAttribute("data-voice", "speaking");
  expect(await shellTree(page, ".eris")).toMatchSnapshot("speaking-300ms.json");
});

test("talking over Eris stops her", async ({ page }) => {
  await page.evaluate(() => {
    const { desk, bridge, envelopes } = window.__shell;
    bridge.fake.play("eris", envelopes.eris);
    desk.eris.say("This is a long sentence that will be interrupted.", [
      { word: "This", at: 0 },
      { word: "is", at: 150 },
      { word: "a", at: 260 },
      { word: "long", at: 340 },
    ]);
  });
  await step(page, 300);
  await page.evaluate(() => window.__shell.bridge.fake.play("user", window.__shell.envelopes.user));
  await step(page, 400);
  await expect(page.locator(".eris")).toHaveAttribute("aria-label", "Eris");
});
