import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { openShell, step } from "./shell-helpers";

// Eris's words on the desk at the app's 1280×800 (#161 findings 6, 11 and 12; #158 finding 14):
// her answer can be read whole and found again, and nothing says she listens before the person
// allows the microphone.
test.use({ viewport: { width: 1280, height: 800 } });

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const MODULES = {
  view: `/@fs${here("../src/eris/float-view.ts")}`,
  float: `/@fs${here("../src/eris/float.ts")}`,
  bridge: `/@fs${here("../../bridge/src/index.ts")}`,
};
const PROMPT =
  "Tell me why the answer under Eris has to wrap: it has more than two hundred characters, so " +
  "one line would run off the desk, and a person should still be able to read all of it later.";
const REPLY = `I'll look into "${PROMPT}" and tell you.`;
const FAILED = "Something went wrong on my side. Try that again in a moment.";

declare global {
  interface Window {
    /** This spec's answer to the desk's microphone question, once it is asked. */
    __mic?: (granted: boolean) => void;
  }
}

/** Say `text` to Eris on the talk line, as a person does, and let her answer. */
async function tell(page: Page, text: string): Promise<void> {
  await page.locator("#composer-input").focus();
  await page.keyboard.type(text);
  // The last choice says it to Eris.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await step(page, 2500);
}

/** Her card's text, its lines and whether every one of their boxes is inside the desk. */
function card(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".eris-said");
    if (!el || el.hidden) return null;
    const text = el.querySelector<HTMLElement>(".eris-said-text");
    const glyphs = text?.hidden ? el.querySelector(".soul") : text;
    const range = document.createRange();
    if (glyphs) range.selectNodeContents(glyphs);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    const box = el.getBoundingClientRect();
    const within = (r: DOMRect) =>
      r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    return {
      text: text?.hidden ? "" : (text?.textContent ?? ""),
      lines: new Set(rects.map((r) => Math.round(r.top))).size,
      inside: rects.length > 0 && rects.every(within) && within(box),
      overlay: el.classList.contains("popover"),
    };
  });
}

test("an answer of 240 characters wraps inside the desk and is still there after 10 s", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  await tell(page, PROMPT);
  const shown = await card(page);
  expect(shown).toMatchObject({ text: REPLY, inside: true, overlay: true });
  expect(shown?.lines).toBeGreaterThanOrEqual(3);
  await step(page, 10_000);
  expect(await card(page)).toEqual(shown);
  // Screen readers hear it once.
  await expect(page.locator(".soul-live")).toHaveText(REPLY);
});

test("closed, her answer comes back with Show what Eris said", async ({ page }) => {
  await openShell(page, "?lang=en");
  await tell(page, PROMPT);
  await page.getByRole("button", { name: "Close" }).click();
  await step(page, 100);
  expect(await card(page)).toBeNull();
  await page.locator("#composer-input").focus();
  await page.keyboard.type("what Eris said");
  await expect(page.getByRole("option").first()).toHaveText("Show what Eris said");
  await page.keyboard.press("Enter");
  await step(page, 100);
  expect(await card(page)).toMatchObject({ text: REPLY, inside: true });
});

test("a short line wraps inside the desk wherever she floats", async ({ page }) => {
  await openShell(page, "?lang=en");
  const eris = page.locator(".eris");
  const at = await eris.boundingBox();
  if (!at) throw new Error("no Eris");
  await page.mouse.move(at.x + 64, at.y + 69);
  await page.mouse.down();
  await page.mouse.move(1200, 300, { steps: 8 });
  await page.mouse.move(1270, 300, { steps: 4 });
  await page.mouse.up();
  await step(page, 100);
  await page.evaluate((line) => window.__shell.desk.eris.say(line), FAILED);
  await step(page, 3000);
  const shown = await card(page);
  expect(shown).toMatchObject({ text: "", inside: true });
  expect(shown?.lines).toBeGreaterThanOrEqual(2);
  // It leaves with its soul text.
  await step(page, 4000);
  expect(await card(page)).toBeNull();
});

test("nothing says she listens until the microphone is allowed", async ({ page }) => {
  await openShell(page, "?lang=en");
  await page.evaluate(() => {
    const { perm } = window.__shell.bridge;
    perm.request = () => new Promise<boolean>((answer) => (window.__mic = answer));
  });
  const eris = page.locator(".eris");
  await eris.click();
  await step(page, 500);
  await expect(eris).toHaveAttribute("data-talk", "asking");
  await expect(eris).not.toHaveAttribute("data-state", "listening");
  await expect(eris).toHaveAttribute("aria-label", "Eris");
  const rail = page.locator('[data-rail="listen"]');
  await rail.click();
  await step(page, 100);
  await expect(rail).toHaveAttribute("aria-label", "Listening · off");
  await expect(rail).toHaveAttribute("aria-pressed", "false");
  expect(await floating(page)).toBe("Waiting for your approval");
  // The person says no: she says she can be typed to, and nothing listens.
  await page.evaluate(() => window.__mic?.(false));
  await step(page, 300);
  await expect(page.locator(".soul-live")).toHaveText(
    "I need the microphone to hear you. You can type instead.",
  );
  await expect(eris).not.toHaveAttribute("data-state", "listening");
  await expect(rail).toHaveAttribute("aria-label", "Listening · off");
  expect(await floating(page)).not.toBe("Listening…");
});

/** What the floating Eris window reads now, from the snapshot the desk wrote for it (ADR 0121). */
function floating(page: Page): Promise<string> {
  return page.evaluate(async (modules) => {
    const [{ mountErisFloat }, { storageChannel }, { BridgeClient, browserStub }] =
      await Promise.all([import(modules.view), import(modules.float), import(modules.bridge)]);
    const root = document.createElement("div");
    root.hidden = true;
    document.body.append(root);
    const view = mountErisFloat(root, {
      core: new BridgeClient(browserStub({})),
      channel: storageChannel(window),
      clock: window.__shell.clock,
      lang: "en",
      shortcut: () => undefined,
      reduced: () => true,
      dismiss: () => {},
      expand: () => {},
      reveal: () => {},
      drag: () => {},
    });
    const status = root.querySelector(".eris-float-status")?.textContent ?? "";
    view.dispose();
    root.remove();
    return status;
  }, MODULES);
}
