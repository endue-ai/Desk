// The focus at a start (issues 160 and 163). The window desk.windows.list marks in use has the
// keys without a click: the compositor's router names its surface, and what is typed reaches it
// (the Terminal of the Default profile, whose shell starts in HOME, so a `touch` shows where the
// keys went). A relaunch with files open in two plugins (a note and an image) used to loop the
// focus between their windows for good: it settles on the window in use when the desk quit, and
// the window manager publishes nothing more. Keys are winit's, fed to the compositor window
// (support/compositor.ts): the screen may be locked. browser.reloadSession() quits the app and
// starts it again with the same HOME (support/driver.ts).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { feed, inputState, keyPress, shellCommand } from "../support/compositor";
import { shellReady, waitForData } from "../support/desk";
import { HOME_VAR } from "../support/driver";
import { deskNow, inUse, run } from "../support/windows";

const TERMINAL = "endue.terminal";
const TERMINAL_HOST = "main.endue-terminal";
/** A 1×1 PNG: the image the Images plugin opens. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

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
async function keysReachTerminal(name: string): Promise<void> {
  await holds(
    async () => (await inputState()).focused === TERMINAL_HOST,
    "the window in use never had the keys",
  );
  await typeLine(`touch ${name}`);
  await holds(
    () => existsSync(join(home(), name)),
    `what was typed never reached the Terminal's shell (no ~/${name})`,
  );
}

/** The window the desk's page draws in use, read every 100 ms for `ms`: each one seen in turn. */
const focusSeen = (ms: number) =>
  browser.execute(
    (ms: number) =>
      new Promise<Array<string | null>>((resolve) => {
        const seen: Array<string | null> = [];
        const look = () => {
          const id = document.querySelector<HTMLElement>("section.surface.is-focused")?.dataset
            .surface;
          if (seen.at(-1) !== (id ?? null)) seen.push(id ?? null);
        };
        const timer = setInterval(look, 100);
        setTimeout(() => {
          clearInterval(timer);
          resolve(seen);
        }, ms);
      }),
    ms,
  );

const rev = async () => (await shellCommand<{ wm: { rev: number } }>("compositor_stats")).wm.rev;

type Store = { desk?: { session?: { focused?: string | null; files?: unknown[] } } };
const session = (value: unknown) => (value as Store | undefined)?.desk?.session;

describe("focus: the window in use at a start has the keys, and the focus settles", () => {
  beforeEach(async () => {
    await shellReady();
    await feed([{ type: "windowFocused", focused: true }]);
  });

  it("a fresh start: keys typed without a click reach the window marked in use", async () => {
    await holds(
      async () => inUse(await deskNow())?.id === TERMINAL,
      "the Terminal is not the window in use at a fresh start",
    );
    await keysReachTerminal("typedatstart");
  });

  it("a relaunch with a note and an image open: one window stays in use, and it has the keys", async () => {
    mkdirSync(join(home(), "Notes"), { recursive: true });
    mkdirSync(join(home(), "pics"), { recursive: true });
    const note = join(home(), "Notes", "hello.md");
    const image = join(home(), "pics", "red.png");
    writeFileSync(note, "# hello\n");
    writeFileSync(image, Buffer.from(PNG, "base64"));
    await run("desk.files.open", { path: note });
    await run("desk.files.open", { path: image });
    await run("desk.windows.focus", { window: TERMINAL });
    await waitForData(
      "store.json",
      (value) => session(value)?.focused === TERMINAL && session(value)?.files?.length === 2,
      "desk.session with both files and the Terminal in use",
    );

    await browser.reloadSession();
    await shellReady();
    await feed([{ type: "windowFocused", focused: true }]);
    await holds(
      async () => inUse(await deskNow())?.id === TERMINAL,
      "the Terminal is not in use after the relaunch",
    );
    // 40 looks over 4 s: the window in use never changes.
    expect(await focusSeen(4000)).toEqual([TERMINAL]);
    // The window manager publishes nothing while the desk rests.
    const before = await rev();
    await browser.pause(2000);
    expect(await rev()).toBe(before);
    await keysReachTerminal("typedafterrelaunch");
  });
});
