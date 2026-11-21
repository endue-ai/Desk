import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell, step } from "./shell-helpers";

// How Eris works a line, end to end (ADR 0089, ADR 0271, ADR 0275): the line flies from the talk
// line into her, she takes it in and reads it, her ring turning, and only then does an errand
// leave: a labelled spark in her gold along a thread to the plugin's window, which glows in the
// star's colour from the moment the spark lands until the plugin answers, and the answer flies back
// to her in the star's colour. A line that runs nothing lights no window.
test.use({ viewport: DESK });

/** How long the line flies into her (Composer's ABSORB_MS) and how long she reads it (READ_MS). */
const FLIGHT = 1400;
const READ = 480;
/**
 * One leg of an errand (LEG_MS), how long its spark stays at the window at least (DWELL_MS), and
 * how long a window's glow takes to come (GLOW_IN_MS).
 */
const LEG = 640;
const DWELL = 520;
const GLOW_IN = 240;

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

/** A computed colour's red, green and blue in 8 bits: `rgb()` as it is, `color(srgb ...)` scaled. */
const rgb = (colour: string) => {
  const [r = 0, g = 0, b = 0] = (colour.match(/[\d.]+/g) ?? []).map(Number);
  const byte = (v: number) => Math.round(colour.startsWith("color(") ? v * 255 : v);
  return [byte(r), byte(g), byte(b)];
};

/** Every window lit at this moment, by the store the compositor reads. */
const lit = (page: Page) =>
  page.evaluate(() => window.__shell.desk.store.get().erisWindows.map((w) => w.id));
/** What Eris is at with a line (`data-mind`): reading, waiting, or nothing. */
const mind = (page: Page) =>
  page.evaluate(() => document.querySelector<HTMLElement>(".eris")?.dataset.mind ?? null);
/** For a person to see the flow: ERIS_SHOTS=<dir> keeps a picture of each moment. */
const shot = async (page: Page, name: string) => {
  const dir = process.env.ERIS_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
};

/**
 * The calendar's window, opened on the desktop in front (the morning desk's first is empty) and put
 * in use, and the surface it shows, which names what an errand to it goes to.
 */
async function windowInUse(page: Page): Promise<{ id: string; plugin: string }> {
  await page.evaluate(() => window.__shell.desk.runtime.commands.run("desk.shell.open-calendar"));
  await step(page, 16);
  const section = page.locator('.surface[data-surface="calendar"]');
  await expect(section).toBeVisible();
  await page.evaluate(() =>
    window.__shell.desk.runtime.commands.run("desk.windows.focus", { window: "calendar" }),
  );
  await step(page, 16);
  return { id: "calendar", plugin: "calendar" };
}

test.beforeEach(async ({ page }) => {
  await openShell(page);
  await step(page, 16);
});

test("a line that runs nothing flies into her, she reads it and answers, and no window lights", async ({
  page,
}) => {
  const { id } = await windowInUse(page);
  await step(page, 16);
  const seen = new Set<string>();
  const look = async () => {
    for (const w of await lit(page)) seen.add(w);
    expect(await page.locator(".errand, .errand-thread, .is-eris-visiting").count()).toBe(0);
  };

  await tell(page, "what is this");
  await step(page, 320);
  await look();
  // The line is still on its way into her.
  await expect(page.locator(".absorb")).toHaveCount(1);
  expect(await mind(page)).toBeNull();
  await step(page, FLIGHT - 320 + 32);
  // It is in her: she reads it, her ring turning in the star's colour.
  await expect(page.locator(".absorb")).toHaveCount(0);
  expect(await mind(page)).toBe("reading");
  const ring = page.locator(".eris .eris-mind");
  await expect(ring).toHaveAttribute("aria-hidden", "true");
  const arc = page.locator(".eris .eris-mind-arc").first();
  expect(rgb(await arc.evaluate((el) => getComputedStyle(el).stroke))).toEqual(
    rgb(await star(page)),
  );
  expect(
    await page
      .locator(".eris .eris-mind-turn")
      .first()
      .evaluate((el) => getComputedStyle(el).animationPlayState),
  ).toBe("running");
  await look();
  await shot(page, "1-reading");

  // She answers once she has read it; her ring goes, and no window was lit at any time.
  await step(page, READ + 32);
  await look();
  expect(await mind(page)).toBeNull();
  await step(page, 600);
  await expect(page.locator(".soul-live")).toHaveText(/what is this/);
  expect([...seen], `window ${id} is in use, but she ran nothing on it`).toEqual([]);
});

test("an errand leaves once the line is read, its window glows while the plugin works, and the answer flies back", async ({
  page,
}) => {
  const { id, plugin } = await windowInUse(page);
  // Her brain runs one command of the window's plugin and waits for the test to let it answer.
  await page.evaluate((provider) => {
    const { bridge } = window.__shell;
    const hold = window as unknown as { __answer?: () => void };
    bridge.brain.say = async (_text, onStep) => {
      const call = { callId: "call-1", command: `${provider}.read`, provider, title: "Read" };
      onStep?.({ kind: "tool", ...call });
      await new Promise<void>((answer) => {
        hold.__answer = answer;
      });
      onStep?.({ kind: "tool-result", ...call, ok: true });
      return { text: "It is tidy now." };
    };
  }, plugin);
  await step(page, 16);
  const section = page.locator(`.surface[data-surface="${id}"]`);

  await tell(page, "tidy this window");
  await step(page, FLIGHT + 32);
  // The line is in her and she reads it: nothing has left her yet.
  expect(await mind(page)).toBe("reading");
  await expect(page.locator(".errand")).toHaveCount(0);
  expect(await lit(page)).toEqual([]);

  await step(page, READ + 32);
  // The errand leaves her for the window, labelled with the plugin, along a thread. (The fixture's
  // clock runs a step's frames before what waits on them: each wait ends in a step of its own.)
  const errand = page.locator(`.errand[data-provider="${plugin}"]`);
  await expect(errand).toHaveAttribute("role", "status");
  await expect(errand).toHaveAttribute("data-leg", "out");
  await expect(errand.locator(".errand-label small")).toHaveText("Read");
  const thread = page.locator(".errand-thread");
  await expect(thread).toHaveAttribute("data-leg", "out");
  expect(await mind(page)).toBe("waiting");
  // Not lit before the spark lands.
  expect(await lit(page)).toEqual([]);
  await step(page, LEG / 2);
  await shot(page, "2-request-out");

  await step(page, LEG / 2 + 32);
  await step(page, GLOW_IN + 32);
  // There: the window glows fully while the plugin works, and the marks stand still.
  await expect(errand).toHaveAttribute("data-leg", "there");
  await expect(thread).toHaveAttribute("data-leg", "there");
  expect(await lit(page)).toEqual([id]);
  await expect(section).toHaveClass(/is-eris-visiting/);
  expect(await section.evaluate((el) => el.style.getPropertyValue("--eris-glow"))).toBe("1");
  await shot(page, "3-window-working");

  // The plugin answers: once the spark has stayed its moment, the answer flies back to her in the
  // star's colour.
  await page.evaluate(() => (window as unknown as { __answer?: () => void }).__answer?.());
  await step(page, 32);
  await expect(errand).toHaveAttribute("data-leg", "there");
  await step(page, DWELL);
  await expect(errand).toHaveAttribute("data-leg", "back");
  await expect(thread).toHaveAttribute("data-leg", "back");
  const spark = await errand
    .locator(".errand-spark")
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(spark, "the answer is drawn in the star's colour").toContain("radial-gradient");
  await step(page, LEG / 2);
  await shot(page, "4-answer-back");

  // Home: she takes it in, the window goes dark, and she says her answer.
  await step(page, LEG / 2 + 32);
  await expect(page.locator(".errand, .errand-thread")).toHaveCount(0);
  await step(page, 600);
  expect(await lit(page)).toEqual([]);
  await expect(section).not.toHaveClass(/is-eris-visiting/);
  expect(await mind(page)).toBeNull();
  await expect(page.locator(".soul-live")).toHaveText("It is tidy now.");
});

test("a plugin without a window: the spark waits beside her and no window lights", async ({
  page,
}) => {
  await tell(page, "check my mail");
  await step(page, FLIGHT + 32);
  await step(page, READ + 32);
  // Mail has no window here: its spark waits beside her, on a thread in the star's colour.
  const errand = page.locator('.errand[data-provider="endue.mail"]');
  await expect(errand.locator(".errand-label")).toHaveText("MailLatest mail");
  const flow = page.locator(".errand-thread .errand-thread-flow");
  const stroke = await flow.evaluate((el) => getComputedStyle(el).stroke);
  expect(rgb(stroke)).toEqual(rgb(await star(page)));
  expect(await lit(page)).toEqual([]);
  // Out, a stay, then home: each leg waits for the one before it, so the clock runs in steps.
  await step(page, LEG + 32);
  await step(page, DWELL + 32);
  await expect(errand).toHaveAttribute("data-leg", "back");
  await step(page, LEG + 64);
  await expect(page.locator(".errand, .errand-thread")).toHaveCount(0);
  await step(page, 100);
  // She answered once the spark was home.
  const said = await page.evaluate(() => window.__shell.desk.store.get().eris.saying);
  expect(said).toContain("2 new messages");
});

test("with reduced motion she reads the line at once, nothing flies and no ring closes", async ({
  page,
}) => {
  await openShell(page, "?reduced=1");
  await step(page, 16);
  await tell(page, "check my mail");
  await step(page, 16);
  await expect(page.locator(".errand")).toHaveCount(0);
  // The line fades where it was; then the errand is beside her and home at once.
  await step(page, 240);
  await step(page, 16);
  await expect(page.locator(".errand, .errand-thread")).toHaveCount(0);
  await expect(page.locator(".is-eris-visiting")).toHaveCount(0);
  expect(
    await page.locator(".eris .eris-intake").evaluate((el) => (el as SVGElement).style.transform),
  ).toBe("");
  await step(page, 100);
  const said = await page.evaluate(() => window.__shell.desk.store.get().eris.saying);
  expect(said).toContain("2 new messages");
});
