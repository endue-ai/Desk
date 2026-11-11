import { expect, type Frame, type Locator, type Page, test } from "@playwright/test";
import { open, run, startSignIn, until, untilScene } from "./first-run";

// The first run at the app's smallest window (1024x500), its default (1280x800) and a large one
// (1500x950): every choice, field and note of a scene lies inside the window, none on another, the
// page never scrolls, and the buttons wear the theme (#161 findings 7, 8 and 10; #163 finding 14).

const SIZES = [
  { width: 1024, height: 500 },
  { width: 1280, height: 800 },
  { width: 1500, height: 950 },
] as const;

interface Box {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxes(parts: Record<string, Locator>): Promise<Box[]> {
  const found: Box[] = [];
  for (const [name, locator] of Object.entries(parts)) {
    await expect(locator, name).toBeVisible();
    const box = await locator.boundingBox();
    if (!box) throw new Error(`${name} has no box`);
    found.push({ name, ...box });
  }
  return found;
}

const meet = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Every part inside the viewport, no two meeting, and the frame's page not scrolling. */
async function fits(page: Page, frame: Frame, parts: Record<string, Locator>) {
  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
  const found = await boxes(parts);
  const outside = found.filter(
    (b) => b.x < 0 || b.y < 0 || b.x + b.width > width || b.y + b.height > height,
  );
  expect(outside, `outside ${width}x${height}: ${JSON.stringify(found)}`).toEqual([]);
  const meeting = found.flatMap((a, i) =>
    found.slice(i + 1).flatMap((b) => (meet(a, b) ? [`${a.name} on ${b.name}`] : [])),
  );
  expect(meeting, JSON.stringify(found)).toEqual([]);
  const overflow = await frame.evaluate(() => ({
    x: document.documentElement.scrollWidth - innerWidth,
    y: document.documentElement.scrollHeight - innerHeight,
  }));
  expect(overflow, "the first run's page scrolls").toEqual({ x: 0, y: 0 });
}

/** What Eris says now, as the box of the caption's visible words. */
const caption = (frame: Frame) => frame.locator("#cap .line").last();

for (const size of SIZES) {
  test.describe(`at ${size.width}x${size.height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(size);
    });

    test("sign-in: the entry's choices, its note and Skip for now", async ({ page }) => {
      const frame = await open(page, "?resume=sign-in&name=Ada");
      await untilScene(page, frame, "sign-in");
      const skip = frame.getByRole("button", { name: "Skip for now" });
      await until(page, skip);
      await run(page, 1000);
      await fits(page, frame, {
        signIn: frame.getByRole("button", { name: "Sign in with endue ID" }),
        create: frame.getByRole("button", { name: "Create account" }),
        skip,
        note: frame.getByText("Start free. No card required."),
        title: frame.getByRole("heading", { name: "A little more you. A lot more possible." }),
        said: caption(frame),
      });
    });

    test("sign-in: the waiting code, Open browser again and Cancel", async ({ page }) => {
      const frame = await open(page, "?resume=sign-in&name=Ada");
      await startSignIn(page, frame);
      await run(page, 1500);
      await fits(page, frame, {
        code: frame.getByText("WDJB-MJHT"),
        again: frame.getByRole("button", { name: "Open browser again" }),
        cancel: frame.getByRole("button", { name: "Cancel" }),
      });
    });

    test("the microphone question and its two answers", async ({ page }) => {
      const frame = await open(page, "?resume=microphone");
      const allow = frame.getByRole("button", { name: "Use my microphone" });
      await until(page, allow);
      await run(page, 1000);
      await fits(page, frame, {
        allow,
        type: frame.getByRole("button", { name: "Not now" }),
        said: caption(frame),
      });
    });

    test("the name: the question, its field and Send", async ({ page }) => {
      const frame = await open(page, "?resume=name");
      const field = frame.getByLabel("Type your name");
      await until(page, field);
      await run(page, 1000);
      await fits(page, frame, {
        label: frame.getByText("Type your name"),
        field,
        send: frame.getByRole("button", { name: "Send" }),
        said: caption(frame),
      });
    });

    test("the sources: the cards and the note", async ({ page }) => {
      const frame = await open(page, "?resume=desk&name=Ada");
      const later = frame.getByRole("button", { name: "Later" });
      await until(page, later);
      await run(page, 1000);
      await fits(page, frame, {
        folder: frame.getByRole("button", { name: "Folder" }),
        calendar: frame.getByRole("button", { name: "Calendar" }),
        mail: frame.getByRole("button", { name: "Mail" }),
        later,
        said: caption(frame),
      });
    });

    test("the first task: the examples and the field", async ({ page }) => {
      const frame = await open(page, "?resume=task&name=Ada&connect=calendar");
      const week = frame.getByRole("button", { name: "Plan my week" });
      await until(page, week);
      await run(page, 1000);
      await fits(page, frame, {
        tomorrow: frame.getByRole("button", { name: "What's on tomorrow?" }),
        week,
        field: frame.getByLabel("Type a task"),
        send: frame.getByRole("button", { name: "Send" }),
        said: caption(frame),
      });
    });

    test("the layout's name: the form at full size beside Eris in the corner", async ({ page }) => {
      const frame = await open(page, "?resume=task&name=Ada");
      await untilScene(page, frame, "task");
      const week = frame.getByRole("button", { name: "Plan my week" });
      await until(page, week);
      await week.click();
      await untilScene(page, frame, "layout");
      const field = frame.getByLabel("Name this layout");
      await until(page, field);
      await run(page, 1500);
      const send = frame.getByRole("button", { name: "Send" });
      await fits(page, frame, {
        label: frame.getByText("Name this layout"),
        field,
        send,
        notNow: frame.getByRole("button", { name: "Not now" }),
      });
      // The same form as the name's: a 240x40 field and a 12 px label, not the stage's half.
      const shown = await field.boundingBox();
      expect(shown?.width).toBeGreaterThanOrEqual(240);
      expect(shown?.height).toBeGreaterThanOrEqual(40);
      const label = await frame.getByText("Name this layout").boundingBox();
      expect(label?.height).toBeGreaterThanOrEqual(12);
    });
  });
}

test.describe("the buttons wear the theme", () => {
  /** A button's colours, beside what the theme's quiet button tokens give. */
  const colours = (button: Locator) =>
    button.evaluate((node) => {
      const probe = document.createElement("span");
      probe.style.background = "var(--desk-button-quiet-bg)";
      probe.style.color = "var(--desk-button-quiet-fg)";
      document.body.append(probe);
      const theme = getComputedStyle(probe);
      const shown = getComputedStyle(node);
      const result = {
        shown: { bg: shown.backgroundColor, fg: shown.color },
        theme: { bg: theme.backgroundColor, fg: theme.color },
      };
      probe.remove();
      return result;
    });

  test("Skip intro is the theme's quiet button, not the browser's", async ({ page }) => {
    const frame = await open(page);
    await run(page, 1500);
    const skip = frame.getByRole("button", { name: "Skip intro" });
    await expect(skip).toBeVisible();
    const { shown, theme } = await colours(skip);
    expect(shown.bg).not.toBe("rgb(239, 239, 239)");
    expect(shown).toEqual(theme);
  });

  test("Skip for now and Not now are the theme's quiet buttons", async ({ page }) => {
    let frame = await open(page, "?resume=sign-in&name=Ada");
    const later = frame.getByRole("button", { name: "Skip for now" });
    await until(page, later);
    let { shown, theme } = await colours(later);
    expect(shown).toEqual(theme);
    frame = await open(page, "?resume=microphone");
    const notNow = frame.getByRole("button", { name: "Not now" });
    await until(page, notNow);
    ({ shown, theme } = await colours(notNow));
    expect(shown).toEqual(theme);
  });
});
