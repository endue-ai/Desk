// The real terminal plugin draws what a plain modern terminal draws (issue 319), in the sandboxed
// frame a plugin page gets, on the browser stub with a scripted PTY (fixture/terminal.ts) that
// prints a made-up test pattern, so its screenshots hold nothing of the machine: colours, the
// underline styles, box drawing, wide characters and a link; then a program's notification on the
// desk's status line, the title stack, a mouse report in the X10 encoding and an OSC 52 copy.
import { expect, type Frame, type Page, test } from "@playwright/test";

const SURFACE = '[data-surface="test.terminal"]';

test.use({ viewport: { width: 1100, height: 640 }, deviceScaleFactor: 2 });

/** The terminal's window, as large as one a person would give a terminal. */
const SIZE = { width: 900, height: 470 };

/** Open the fixture page and the terminal at SIZE, print the pattern, resolve with its frame. */
async function open(page: Page): Promise<Frame> {
  await page.goto("/terminal.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  // The status line fades in on the desk's clock.
  await page.evaluate(() => window.__desk.clock.advance(1000));
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "test.terminal" }),
  );
  const iframe = page.locator(`${SURFACE} iframe`);
  await expect(iframe).toBeVisible();
  // Out of the desk's grid, at the size a person would give a terminal window.
  await page.locator(SURFACE).evaluate((el, { width, height }) => {
    const box = `position:fixed;left:16px;top:16px;width:${width}px;height:${height}px`;
    const rules = `${box};max-width:none;max-height:none;`.replaceAll(";", "!important;");
    (el as HTMLElement).style.cssText += `;${rules}`;
  }, SIZE);
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no terminal frame");
  await expect.poll(() => frame.evaluate(() => innerWidth)).toBeGreaterThan(SIZE.width - 40);
  await expect(frame.locator(".xterm-rows")).toBeVisible();
  await page.evaluate(() => window.__terminal.print(window.__terminal.pattern));
  await expect(frame.locator(".xterm-rows")).toContainText("test pattern");
  return frame;
}

const print = (page: Page, text: string) =>
  page.evaluate((text) => window.__terminal.print(text), text);

/** The terminal's rows as text, one string each. */
const rows = (frame: Frame) =>
  frame.locator(".xterm-rows > div").evaluateAll((divs) => divs.map((d) => d.textContent ?? ""));

test("the terminal draws colours, styles, boxes and wide characters", async ({ page }, info) => {
  const frame = await open(page);
  const text = (await rows(frame)).join("\n");
  for (const label of ["16 colours", "256 colours", "truecolor", "styles", "boxes", "wide"]) {
    expect(text).toContain(label);
  }
  expect(text).toContain("┌──┬──┐");
  expect(text).toContain("한글 터미널");
  // Each underline style is a class of its own; the red curl's colour is its own too.
  for (const style of [1, 2, 3, 4, 5]) {
    await expect(frame.locator(`.xterm-underline-${style}`).first()).toBeVisible();
  }
  for (const name of ["bold", "dim", "italic", "strikethrough", "overline"]) {
    await expect(frame.locator(`.xterm-${name}`).first()).toBeVisible();
  }
  const curl = frame.locator(".xterm-underline-3", { hasText: "red curl" });
  await expect(curl).toHaveCSS("text-decoration-color", "rgb(230, 60, 60)");
  // The tab took the program's title.
  await expect(frame.locator(".tab-title").first()).toHaveText("demo");
  await page
    .locator(SURFACE)
    .first()
    .screenshot({ path: info.outputPath("terminal-pattern.png") });
});

test("a program's notification reaches the desk's status line", async ({ page }, info) => {
  await open(page);
  await print(page, "\x1b]777;notify;Build;All 42 tests passed\x07");
  const status = page.locator(".desk-status");
  await expect(status).toContainText("Build");
  await expect(status).toContainText("All 42 tests passed");
  await page.screenshot({ path: info.outputPath("terminal-notification.png") });
});

test("an editor gives the tab its title back when it quits", async ({ page }) => {
  const frame = await open(page);
  const title = frame.locator(".tab-title").first();
  await print(page, "\x1b]2;~/demo\x07");
  await expect(title).toHaveText("~/demo");
  await print(page, "\x1b[22;0t\x1b]2;notes.md - VIM\x07");
  await expect(title).toHaveText("notes.md - VIM");
  await print(page, "\x1b[23;0t");
  await expect(title).toHaveText("~/demo");
});

test("a click reaches a program that asked for X10 mouse reports", async ({ page }) => {
  const frame = await open(page);
  await print(page, "\x1b[?1000h");
  const screen = frame.locator(".xterm-screen");
  const box = await screen.boundingBox();
  if (!box) throw new Error("no screen");
  await screen.click({ position: { x: 40, y: 40 } });
  await expect
    .poll(() =>
      page.evaluate(() => window.__terminal.writes.filter((w) => w.encoding === "base64")),
    )
    .not.toEqual([]);
  const bytes = await page.evaluate(() =>
    window.__terminal.writes
      .filter((w) => w.encoding === "base64")
      .map((w) => atob(w.data))
      .join(""),
  );
  // A press then a release, each ESC [ M and three bytes: button, column and row, plus 32.
  expect(bytes.startsWith("\x1b[M ")).toBe(true);
  expect(bytes).toContain("\x1b[M#");
});

test("an OSC 52 copy lands on the clipboard and the status line says so", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const frame = await open(page);
  // A click first: the webview copies only with a recent key or click, as when a person yanks in vim.
  await frame.locator(".xterm-screen").click({ position: { x: 40, y: 40 } });
  await print(page, `\x1b]52;c;${Buffer.from("copied from a program").toString("base64")}\x07`);
  await expect(frame.locator("#status")).toHaveText("demo copied 21 characters.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("copied from a program");
});
