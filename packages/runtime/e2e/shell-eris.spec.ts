import { expect, type Locator, type Page, test } from "@playwright/test";
import { RETURN_MS } from "../src/eris/rest";
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

/** A box's size, whole pixels. */
const sizeOf = async (el: Locator) => {
  const box = await el.boundingBox();
  return box ? { w: Math.round(box.width), h: Math.round(box.height) } : null;
};
/**
 * Where Eris stands to the talk pill: how far her centre is from the pill's, and the space between
 * her bottom and the pill's top. Out, she is centred over it with 12 between (ADR 0254).
 */
const overPill = (page: Page) =>
  page.evaluate(() => {
    const eris = document.querySelector(".eris")?.getBoundingClientRect();
    const pill = document.querySelector(".talk-pill")?.getBoundingClientRect();
    if (!eris || !pill) return null;
    return {
      dx: Math.round(eris.left + eris.width / 2 - (pill.left + pill.width / 2)),
      gap: Math.round(pill.top - eris.bottom),
    };
  });
const OVER = { dx: 0, gap: 12 };
/** Run her clock until her soul text is gone. */
const untilSilent = (page: Page) =>
  page.evaluate(() => {
    for (let i = 0; i < 1000 && document.querySelector(".soul-line"); i++) window.__shell.step(16);
  });

test.beforeEach(async ({ page }) => {
  await openShell(page);
});

test("at rest Eris is in the talk line, and comes out above it while she speaks", async ({
  page,
}) => {
  await step(page, 16);
  const eris = page.locator(".eris");
  await expect(eris).toBeHidden();
  await expect(eris).toHaveClass(/is-resting/);
  await expect(eris).toHaveAttribute("aria-hidden", "true");
  await expect(eris).toHaveAttribute("tabindex", "-1");
  expect(await sizeOf(page.locator(".talk-pill"))).toEqual({ w: 440, h: 40 });
  expect(await sizeOf(page.locator(".talk-pill .talk-orb"))).toEqual({ w: 18, h: 18 });
  await expect(page.locator(".talk-pill .talk-shortcut")).toBeVisible();

  await page.evaluate(() => window.__shell.desk.eris.say("Quiet morning."));
  await step(page, 16);
  await expect(eris).toBeVisible();
  await expect(eris).not.toHaveAttribute("aria-hidden");
  await expect.poll(() => overPill(page)).toEqual(OVER);
  // Her words gone, she waits RETURN_MS and goes back into the pill.
  await untilSilent(page);
  await step(page, RETURN_MS - 16);
  await expect(eris).not.toHaveClass(/is-resting/);
  await step(page, 32);
  await expect(eris).toHaveClass(/is-resting/);
  await expect(eris).toBeHidden();
});

test("a profile that places Eris keeps her there at rest", async ({ page }) => {
  await page.evaluate(() => {
    const { desk } = window.__shell;
    desk.store.set((s) => ({
      session: {
        ...s.session,
        1: {
          surfaces: [],
          eris: { x: 200, y: 300 },
          rail: { visible: true },
          drawer: { visible: true },
        },
      },
    }));
  });
  await step(page, 16);
  const eris = page.locator(".eris");
  await expect(eris).toBeVisible();
  await expect(eris).toHaveCSS("left", "200px");
  await expect(eris).toHaveCSS("top", "300px");
  await step(page, RETURN_MS + 3000);
  await expect(eris).toBeVisible();
  await expect(eris).not.toHaveClass(/is-resting/);
  await expect(eris).toHaveAttribute("tabindex", "0");
});

test("under reduced motion she comes and goes without animation", async ({ page }) => {
  await openShell(page, "?reduced=1");
  await step(page, 16);
  const eris = page.locator(".eris");
  await expect(eris).toHaveAttribute("data-motion", "none");
  const durations = () =>
    eris.evaluate((el) =>
      getComputedStyle(el)
        .transitionDuration.split(", ")
        .map((d) => Number.parseFloat(d)),
    );
  expect((await durations()).every((d) => d === 0)).toBe(true);
  await page.evaluate(() => window.__shell.desk.eris.setState("done"));
  await step(page, 16);
  await expect(eris).toBeVisible();
  expect(await overPill(page)).toEqual(OVER);
  expect((await durations()).every((d) => d === 0)).toBe(true);
});

test("Eris switches between her six states on the same mesh", async ({ page }) => {
  const digests = new Set<string>();
  for (const state of STATES) {
    await page.evaluate((s) => window.__shell.desk.eris.setState(s), state);
    await step(page, 500);
    await expect(page.locator(".eris")).toHaveAttribute("data-state", state);
    // Idle from the start she is in the pill; in every other state she stands over it.
    if (state === "idle") await expect(page.locator(".eris")).toBeHidden();
    else await expect.poll(() => overPill(page)).toEqual(OVER);
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
  await expect.poll(() => overPill(page)).toEqual(OVER);
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
  await expect.poll(() => overPill(page)).toEqual(OVER);
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
  await expect.poll(() => overPill(page)).toEqual(OVER);
  await expect(page.locator(".eris-mesh")).toHaveAttribute("data-voice", "speaking");
  expect(await shellTree(page, ".eris")).toMatchSnapshot("speaking-300ms.json");
});

test("a click on Eris listens, thinks and speaks, the mesh moving with each", async ({ page }) => {
  // No microphone and no platform voice here: she listens to the sample voice and answers the sample.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true });
  });
  const eris = page.locator(".eris");
  await expect(eris).toHaveAttribute("role", "button");
  // At rest she is in the pill: a heads-up brings her out, and a click on her starts the turn.
  await page.evaluate(() => window.__shell.desk.eris.setState("heads-up"));
  await step(page, 16);
  await expect.poll(() => overPill(page)).toEqual(OVER);
  await eris.click();
  await step(page, 16);
  await expect(eris).toHaveAttribute("data-talk", "listening");
  await expect(eris).toHaveAttribute("data-state", "listening");
  await expect(eris).toHaveAttribute("aria-label", "Eris: 듣는 중");
  // The sample voice starts 500 ms in and pulls the rings in from the rim.
  await step(page, 1200);
  await expect(page.locator(".eris-mesh")).toHaveAttribute("data-voice", "listening");
  expect(Math.min(...(await rings(page)))).toBeLessThan(0);
  // 1.4 s of voice, then 1.1 s of quiet: she stops listening and thinks.
  await step(page, 2000);
  await expect(eris).toHaveAttribute("data-talk", "thinking");
  await expect(eris).toHaveAttribute("data-state", "thinking");
  await step(page, 600);
  await expect(page.locator(".eris-mesh")).toHaveAttribute("data-voice", "thinking");
  // At least 1.1 s of thinking, then the line, one pulse per syllable leaving the core.
  await step(page, 600);
  await step(page, 300);
  await expect(eris).toHaveAttribute("data-talk", "speaking");
  await expect(page.locator(".soul-live")).toHaveText("샘플 목소리를 들었어요. 이렇게 말해요.");
  await step(page, 300);
  await expect(page.locator(".eris-mesh")).toHaveAttribute("data-voice", "speaking");
  expect(Math.max(...(await rings(page)))).toBeGreaterThan(0);
  // Escape ends the turn.
  await eris.press("Escape");
  await step(page, 16);
  await expect(eris).not.toHaveAttribute("data-talk");
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
