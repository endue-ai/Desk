// The keys follow the window in use (issues 158 #10, 159 #2 #5 #6, 160 #11, 162 #6 #7; ADR XXXX).
// The window desk.windows.list marks in use has the keys without a click after Ctrl+Tab, a title
// drag, a command that shows a window, a file that opens, a permission question and the palette
// closing, and a press on a divider or on a desk button gives them to no window lying under it.
// The Default profile's Terminal, whose shell starts in HOME, shows where the keys went: a `touch`
// typed without a click makes its file there. The pointer and the keys are winit's, fed to the
// compositor window (support/compositor.ts): the screen may be locked. e2e.ask (wdio.conf.ts) asks
// for a folder, which brings up the permission question.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { click, feed, inputState, keyPress } from "../support/compositor";
import { inFrame, press, shellReady } from "../support/desk";
import { HOME_VAR } from "../support/driver";
import { bodyAt, drag, drawerButtonAt, release, titleAt } from "../support/gestures";
import { deskNow, inUse, rectOf, run, windowNow, windowUntil } from "../support/windows";

const TERMINAL = "endue.terminal";
const TERMINAL_HOST = "main.endue-terminal";
const PALETTE = "main.desk-palette";
/** A 1×1 PNG: the images the Images plugin walks. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const MOD = process.platform === "darwin" ? { meta: true } : { ctrl: true };

const home = () => {
  const dir = process.env[HOME_VAR];
  if (!dir) throw new Error(`${HOME_VAR} is not set: run the specs through just test-app-e2e`);
  return dir;
};

/** Poll `test` every 100 ms until it holds; past `ms`, fail saying `what`. */
async function holds(test: () => Promise<boolean> | boolean, what: string, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() > end) throw new Error(what);
    await browser.pause(100);
  }
}

const focused = async () => (await inputState()).focused;

/** A chord through the compositor: `mods` held around one key. */
const chord = (mods: Record<string, boolean>, key: string, code: string, text?: string) =>
  feed([{ type: "modifiers", ...mods }, ...keyPress(key, code, text), { type: "modifiers" }]);

/** Type `text` and Enter one key at a time, as a hand does: a burst can reach a shell out of order. */
async function typeLine(text: string): Promise<void> {
  for (const ch of text) {
    const code = ch === " " ? "Space" : `Key${ch.toUpperCase()}`;
    await feed(keyPress(ch, code, ch));
    await browser.pause(15);
  }
  await feed(keyPress("Enter", "Enter"));
}

/** The keys reach the Terminal: a line typed without a click makes its file in HOME. */
async function keysReachTerminal(name: string, after: string): Promise<void> {
  await holds(async () => (await focused()) === TERMINAL_HOST, `${after}: no keys in the Terminal`);
  await typeLine(`touch ${name}`);
  await holds(
    () => existsSync(join(home(), name)),
    `${after}: what was typed never reached the Terminal's shell (no ~/${name})`,
  );
}

/** Make `id` the window in use by command, and wait until its surface has the keys. */
async function use(id: string, host: string): Promise<void> {
  await run("desk.windows.focus", { window: id });
  await windowUntil(id, (w) => w.focused === true, "in use");
  await holds(async () => (await focused()) === host, `${id} in use, without the keys`);
}

/** Bring `id` to the front by command and press its body, which gives its surface the keys. */
async function pressInto(id: string, host: string): Promise<void> {
  await run("desk.windows.focus", { window: id });
  const w = await windowUntil(id, (w) => w.focused === true, "in use");
  const at = bodyAt(rectOf(w));
  await click([at.x, at.y]);
  await holds(async () => (await focused()) === host, `a press in ${id} left it without the keys`);
}

/** The surfaces the windows show, by host: the keys may be with none of them but the one in use. */
const windowHosts = async () =>
  (await deskNow()).windows.flatMap((w) =>
    w.panes.flatMap((p) => (p.plugin ? [`main.${p.plugin.replace(".", "-")}`] : [])),
  );

describe("keys follow the window in use", () => {
  before(async () => {
    await shellReady();
    await feed([{ type: "windowFocused", focused: true }]);
    await holds(async () => inUse(await deskNow())?.id === TERMINAL, "no Terminal in use");
  });

  it("Ctrl+Tab to the Terminal: what is typed reaches its shell", async () => {
    await use("endue.chat", "main.endue-chat");
    for (let presses = 0; presses < 30; presses++) {
      if (inUse(await deskNow())?.id === TERMINAL) break;
      await chord({ ctrl: true }, "Tab", "Tab", "\t");
      await browser.pause(300);
    }
    expect(inUse(await deskNow())?.id).toBe(TERMINAL);
    await keysReachTerminal("afterctrltab", "Ctrl+Tab");
  });

  it("a title drag keeps the keys with the window dragged", async () => {
    const before = await windowNow(TERMINAL);
    const from = titleAt(rectOf(before));
    await drag(from, { x: from.x + 30, y: from.y + 20 });
    await windowUntil(TERMINAL, (w) => w.x !== before.x || w.y !== before.y, "moved by its title");
    await keysReachTerminal("aftertitledrag", "a title drag");
  });

  it("the palette closing gives the keys back to the window that had them", async () => {
    await chord(MOD, "k", "KeyK", "k");
    await holds(async () => (await focused()) === PALETTE, "the palette never had the keys");
    await feed(keyPress("Escape", "Escape"));
    await keysReachTerminal("afterpalette", "the palette closing");
  });

  it("a command that shows a window gives it the keys", async () => {
    await run("desk.windows.focus", { window: "endue.git" });
    await holds(async () => (await focused()) === "main.endue-git", "Switch to window: Git");
    await run("desk.display.show", { plugin: TERMINAL });
    await keysReachTerminal("aftershow", "desk.display.show");
  });

  it("a file that opens has the keys: Images walks its folder key after key", async () => {
    const pics = join(home(), "pics");
    mkdirSync(pics, { recursive: true });
    for (const name of ["a", "b", "c"]) writeFileSync(join(pics, `${name}.png`), PNG, "base64");
    await run("desk.files.open", { path: join(pics, "a.png") });
    await holds(async () => (await focused()) === "main.endue-images", "the image has no keys");
    const shown = async () =>
      ((await run("desk.buffers.list")) as Array<{ path?: string; plugin?: string }>)
        .filter((b) => b.plugin === "endue.images" && b.path)
        .map((b) => b.path?.split("/").at(-1));
    for (const next of ["b.png", "c.png"]) {
      await feed(keyPress("ArrowRight", "ArrowRight"));
      await holds(async () => (await shown()).includes(next), `ArrowRight never showed ${next}`);
      expect(await focused()).toBe("main.endue-images");
    }
  });

  it("a permission question has the keys: Escape answers it", async () => {
    await inFrame("e2e.ask", () => press('button[data-folder="~/Pictures/2025"]'));
    await holds(
      async () => /\.endue-permissions$/.test((await focused()) ?? ""),
      "the question never had the keys",
    );
    await feed(keyPress("Escape", "Escape"));
    await holds(
      async () =>
        (
          await inFrame("e2e.ask", () =>
            browser.execute(() => document.querySelector("[data-testid=answers]")?.textContent),
          )
        )?.includes('~/Pictures/2025: {"granted":false') === true,
      "Escape never answered the question",
    );
  });

  it("a press on a divider gives the keys to no window lying under it", async () => {
    // Calendar over the Terminal, split: its divider lies over the Terminal's surface.
    await pressInto("endue.calendar", "main.endue-calendar");
    const calendar = await windowNow("endue.calendar");
    const terminal = await windowNow(TERMINAL);
    await run("desk.display.split-right");
    await windowUntil("endue.calendar", (w) => w.panes.length === 2, "split");
    const divider = await browser.execute(() => {
      const r = document
        .querySelector('section.surface[data-surface="endue.calendar"] .divider')
        ?.getBoundingClientRect();
      // Its first quarter: the 1 px line between the two panes' surfaces, whatever the rounding.
      return r ? { x: r.x + r.width / 4, y: r.y + r.height / 2 } : null;
    });
    if (!divider) throw new Error("the split Calendar has no divider");
    const under = { x: divider.x, y: Math.max(divider.y, terminal.y + 60) };
    expect(under.y < calendar.y + calendar.h && under.x > terminal.x).toBe(true);
    await drag(under, { x: under.x + 20, y: under.y }, { hold: true });
    const held = await inputState();
    await release();
    // The press is the split window's, heard by the page that lays it out.
    expect(held.pointer.capture).toBe("desk");
    expect(held.focused).not.toBe(TERMINAL_HOST);
    expect(await focused()).not.toBe(TERMINAL_HOST);
  });

  it("a press on the Drawer button or on Tile gives the keys to no window lying under it", async () => {
    // The desk's buttons are parts of the system layer (ADR 0167): this guards the keys after them.
    await pressInto(TERMINAL, TERMINAL_HOST);
    const screen = (await deskNow()).screen;
    const drawer = drawerButtonAt(screen);
    await click([drawer.x, drawer.y]);
    await browser.pause(400);
    const others = (await windowHosts()).filter((h) => h !== TERMINAL_HOST);
    expect(others).not.toContain(await focused());
    await feed(keyPress("Escape", "Escape"));
    const tile = await browser.execute(() => {
      const r = document.querySelector('button[data-arrange="tile"]')?.getBoundingClientRect();
      return r ? [r.x + r.width / 2, r.y + r.height / 2] : null;
    });
    if (!tile) throw new Error("no Tile windows button");
    await click(tile as [number, number]);
    await browser.pause(600);
    const now = inUse(await deskNow())?.id;
    const notInUse = (await windowHosts()).filter((h) => h !== `main.${now?.replace(".", "-")}`);
    expect(notInUse).not.toContain(await focused());
  });
});
