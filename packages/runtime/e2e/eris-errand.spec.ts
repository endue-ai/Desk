import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell, step } from "./shell-helpers";

// A line to Eris reaches the window in use (ADR 0271): it glows in the star's colour around its
// frame while she looks at it, a bare spark goes there and back along a thread whose marks run the
// way the data goes, and nothing of it stays once she has answered. A hand-off to a plugin is a
// labelled spark on a thread of its own (ADR 0089).
test.use({ viewport: DESK });

/** Say `text` to Eris on the talk line, as a person does; the clock stands still. */
async function tell(page: Page, text: string): Promise<void> {
  await page.locator("#composer-input").focus();
  await page.keyboard.type(text);
  // The last choice says it to Eris.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
}

/** The star's colour as the theme in force has it, as a computed colour. */
const star = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--desk-star)";
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });

/**
 * A computed colour's red, green and blue in 8 bits and its alpha (1 when it has none): `rgb()`
 * and `rgba()` as they are, `color(srgb ...)`, which a colour mixed in CSS is, from its fractions.
 */
const channels = (colour: string) => {
  const [r = 0, g = 0, b = 0, a = 1] = (colour.match(/[\d.]+/g) ?? []).map(Number);
  const byte = (v: number) => Math.round(colour.startsWith("color(") ? v * 255 : v);
  return { rgb: [byte(r), byte(g), byte(b)], a };
};

test.beforeEach(async ({ page }) => {
  await openShell(page);
  await step(page, 16);
});

test("the window in use glows softly while Eris looks at it, and a spark goes there and back", async ({
  page,
}) => {
  // The window the desk has in use is the one her brain hears of as "this": the fixture starts
  // with none, so the first on the desktop in front is taken into use, as the palette would.
  const id = await page.evaluate(async () => {
    const { commands } = window.__shell.desk.runtime;
    type Seen = { windows: { id: string; focused?: boolean; hidden?: boolean }[] };
    const first = ((await commands.run("desk.windows.list")) as Seen).windows.find(
      (w) => !w.hidden,
    );
    if (!first) return null;
    await commands.run("desk.windows.focus", { window: first.id });
    const now = (await commands.run("desk.windows.list")) as Seen;
    return now.windows.find((w) => w.focused)?.id ?? null;
  });
  expect(id, "the fixture has a window in use").not.toBeNull();
  await step(page, 16);
  const inUse = page.locator(`.surface[data-surface="${id}"]`);
  await expect(inUse).not.toHaveClass(/is-eris-visiting/);

  await tell(page, "what is this");
  await step(page, 320);
  await expect(inUse).toHaveClass(/is-eris-visiting/);
  expect(await inUse.evaluate((el) => el.style.getPropertyValue("--eris-glow"))).toBe("0.6");
  // Around its frame, in the star's colour, softer than a window she uses.
  const lit = await inUse.evaluate((el) => {
    const style = getComputedStyle(el);
    return { style: style.outlineStyle, width: style.outlineWidth, colour: style.outlineColor };
  });
  expect([lit.style, lit.width]).toEqual(["solid", "2px"]);
  const rim = channels(lit.colour);
  expect(rim.rgb).toEqual(channels(await star(page)).rgb);
  expect(rim.a).toBeCloseTo(0.45, 2);
  // No other window is lit.
  await expect(page.locator(".surface.is-eris-visiting")).toHaveCount(1);

  // A bare spark on its way there along a thread, both out of the accessibility tree.
  const spark = page.locator(".errand.errand--look");
  await expect(spark).toHaveCount(1);
  await expect(spark).toHaveAttribute("aria-hidden", "true");
  await expect(spark).toHaveAttribute("data-leg", "out");
  const thread = page.locator(".errand-thread.errand-thread--look");
  await expect(thread).toHaveAttribute("data-leg", "out");
  // The thread's box holds the spark's whole way: from her to the window's middle.
  const reach = await page.evaluate((window_) => {
    const box = (el: Element | null) => el?.getBoundingClientRect();
    const t = box(document.querySelector(".errand-thread"));
    const w = box(document.querySelector(`.surface[data-surface="${window_}"]`));
    const e = box(document.querySelector(".eris-body"));
    if (!t || !w || !e) return null;
    const inside = (x: number, y: number) =>
      x >= t.left && x <= t.right && y >= t.top && y <= t.bottom;
    return {
      window: inside(w.left + w.width / 2, w.top + w.height / 2),
      eris: inside(e.left + e.width / 2, e.top + e.height / 2),
    };
  }, id);
  expect(reach).toEqual({ window: true, eris: true });

  // There, then back, then gone; the window goes dark after it. Each leg waits for the one
  // before it, so the clock runs in steps.
  await step(page, 640);
  await expect(spark).toHaveAttribute("data-leg", "back");
  await step(page, 700);
  await expect(page.locator(".errand, .errand-thread")).toHaveCount(0);
  await step(page, 600);
  await expect(page.locator(".is-eris-visiting")).toHaveCount(0);
  expect(await inUse.evaluate((el) => el.style.getPropertyValue("--eris-glow"))).toBe("");
});

test("a hand-off to a plugin is a labelled spark on a thread, home before she answers", async ({
  page,
}) => {
  await tell(page, "check my mail");
  await step(page, 320);
  // Mail has no window here: its spark waits beside her. No window is in use, so she looks at none.
  const errand = page.locator('.errand[data-provider="endue.mail"]');
  await expect(errand).toHaveAttribute("role", "status");
  await expect(errand.locator(".errand-label")).toHaveText("MailLatest mail");
  await expect(page.locator(".errand-thread:not(.errand-thread--look)")).toHaveCount(1);
  // The marks run in the star's colour, and stand still once the spark is there.
  const flow = page.locator(".errand-thread:not(.errand-thread--look) .errand-thread-flow");
  const stroke = await flow.evaluate((el) => getComputedStyle(el).stroke);
  expect(channels(stroke).rgb).toEqual(channels(await star(page)).rgb);
  // Out, then home: each leg waits for the one before it, so the clock runs in steps.
  await step(page, 400);
  await expect(errand).toHaveAttribute("data-leg", "back");
  await step(page, 700);
  await expect(page.locator(".errand, .errand-thread")).toHaveCount(0);
  await step(page, 100);
  // She answered once the spark was home.
  const said = await page.evaluate(() => window.__shell.desk.store.get().eris.saying);
  expect(said).toContain("2 new messages");
});

test("with reduced motion the window lights at once and nothing flies", async ({ page }) => {
  await openShell(page, "?reduced=1");
  await step(page, 16);
  await tell(page, "check my mail");
  await step(page, 16);
  await expect(page.locator(".errand-thread")).toHaveCount(0);
  await expect(page.locator(".errand--look")).toHaveCount(0);
  await step(page, 16);
  await step(page, 16);
  await expect(page.locator(".errand")).toHaveCount(0);
  await expect(page.locator(".is-eris-visiting")).toHaveCount(0);
});
