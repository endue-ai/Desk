// The terminal on the CEF desk (#160), with the person's shell in a real PTY. Closed by its window's
// × and opened again, it follows the same shell: the runtime keeps routing the core's proc.output
// to a plugin put away for the session, whose processes go on. Keys that reach it in one burst
// reach the shell in the order typed (the plugin sends one write at a time). "Focus the terminal"
// (Control+`) from another window brings it forward with the keys, and on macOS ⌥← and ⌥→ move the
// shell's caret a word. Keys and clicks go through the compositor's own input
// (support/compositor.ts); what the terminal received is read through its own command.
import { browser, expect } from "@wdio/globals";
import { click, feed, inputState, keyPress, visiblePoint } from "../support/compositor";
import { shellReady } from "../support/desk";
import { toolAt } from "../support/gestures";
import { byId, clearDesk, run, until, windowUntil } from "../support/windows";

const TERMINAL = "endue.terminal";
const HOST = "main.endue-terminal";
const HELLO = "e2e.hello";

const CODES: Record<string, string> = { " ": "Space" };
const codeOf = (ch: string) =>
  CODES[ch] ?? (/\d/.test(ch) ? `Digit${ch}` : `Key${ch.toUpperCase()}`);
/** The key events that type `text`. */
const typing = (text: string) => [...text].flatMap((ch) => keyPress(ch, codeOf(ch), ch));
const ENTER = keyPress("Enter", "Enter");
/** A key with modifiers held, as winit reports it. */
const held = (mods: Record<string, boolean>, key: string, code: string) => [
  { type: "modifiers", ...mods },
  ...keyPress(key, code),
  { type: "modifiers" },
];

/**
 * The lines of what the terminal on screen received from its shell (`endue.terminal.output`): the
 * text its page wrote into the emulator, read over the desk socket without leaving the main page.
 */
async function lines(): Promise<string[]> {
  const { text } = (await run("endue.terminal.output")) as { text: string };
  return text.split("\n").map((line) => line.trim());
}
/** Wait for a line that reads `text` whole: what a program printed, not the line typed for it. */
const shows = (text: string, what: string) =>
  browser.waitUntil(async () => (await lines()).includes(text), {
    timeout: 20_000,
    interval: 300,
    timeoutMsg: `${what}: no line of the terminal reads "${text}"`,
  });

/** Click where surface `host` of plugin `id` shows and wait until it has the keys. */
async function into(id: string, host: string): Promise<void> {
  await windowUntil(id, (w) => !w.hidden, `${id}'s window shows`);
  const at = await visiblePoint(host);
  if (!at) throw new Error(`${host} shows nowhere`);
  await click(at);
  await browser.waitUntil(async () => (await inputState()).focused === host, {
    timeoutMsg: `${id} never had the keys`,
  });
}

/**
 * The terminal with the keys, once its page has its terminals and the shell's prompt: a click
 * while the page still loads gives the surface the keys but not the emulator inside it.
 */
async function intoTerminal(): Promise<void> {
  const prompted = async () => (await lines().catch(() => [])).some((line) => line !== "");
  await browser.waitUntil(prompted, {
    timeout: 20_000,
    timeoutMsg: "the shell never showed its prompt",
  });
  await into(TERMINAL, HOST);
}

describe("terminal: a real shell in the terminal's window (#160)", () => {
  before(async () => {
    await shellReady();
    await clearDesk([TERMINAL, HELLO]);
    await feed([{ type: "windowFocused", focused: true }]);
  });

  it("closed by its window's × and opened again, it follows the same shell", async function () {
    this.timeout(120_000);
    await intoTerminal();
    await feed([...typing("echo one"), ...ENTER]);
    await shows("one", "before the close");

    const close = toolAt(await windowUntil(TERMINAL, () => true, "the terminal's window"), "close");
    await click([close.x, close.y]);
    await until((d) => byId(d, TERMINAL) === undefined, "the terminal's window closed");
    await run("desk.plugins.open", { plugin: TERMINAL });
    await intoTerminal();
    await feed([...typing("echo two"), ...ENTER]);
    await shows("two", "after the window opened again");
    expect(await run("endue.terminal.sessions")).toMatchObject([{ session: "t-1", running: true }]);
  });

  it("keys that reach it in one burst reach the shell in the order typed", async function () {
    this.timeout(90_000);
    await intoTerminal();
    const letters = "abcdefghijklmnopqrstuvwxyz";
    await feed([...typing(`echo ${letters}`), ...ENTER]);
    await shows(letters, "26 letters in one burst");
  });

  it("Control+` from another window brings the terminal forward with the keys", async function () {
    this.timeout(90_000);
    await into(HELLO, "main.e2e-hello");
    await feed(held({ ctrl: true }, "`", "Backquote"));
    await windowUntil(TERMINAL, (w) => w.focused === true, "the terminal's window in use");
    await browser.waitUntil(async () => (await inputState()).focused === HOST, {
      timeoutMsg: "Control+` left the keys elsewhere",
    });
    await feed([...typing("echo three"), ...ENTER]);
    await shows("three", "the keys after Control+`");
  });

  it("on macOS ⌥← and ⌥→ move the shell's caret a word", async function () {
    if (process.platform !== "darwin") this.skip();
    this.timeout(90_000);
    await intoTerminal();
    await feed([
      ...typing("echo abc"),
      ...held({ alt: true }, "ArrowLeft", "ArrowLeft"),
      ...typing("Z"),
      ...held({ alt: true }, "ArrowRight", "ArrowRight"),
      ...typing("Q"),
      ...ENTER,
    ]);
    await shows("ZabcQ", "a word left, Z, a word right, Q");
  });
});
