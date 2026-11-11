// The Mac's editing keys and the clipboard in an off-screen page (#156). Every page is an
// off-screen browser, which never hears AppKit's key bindings (⌘←, ⌘⌫, ⌃A ...) or the Edit menu's
// key equivalents (⌘A, ⌘C, ⌘X, ⌘V, ⌘Z, ⇧⌘Z), so the shell sends those keys down with the edit
// commands a windowed view would have given Blink (`apps/desk/shell/src/web_host/edit_keys.rs`).
// The keys are winit's, fed to the compositor window's own input entry (support/compositor.ts):
// the screen may be locked. The keys are macOS only: on Windows and Linux Blink binds Ctrl+A,
// Ctrl+C and the rest itself. A right click in a field opens the field menu the shell places in the
// page and judges every press on (`field_menu.rs`), on every platform; a page that draws its own
// menu keeps it. Whatever the first layout gives the fixture's window, it fills the app here and
// its controls move clear of the desk's bars; every point is taken from a control's box.
import { execFileSync } from "node:child_process";
import { browser, expect } from "@wdio/globals";
import { feed, INPUT, inputState, inSurface, keyPress, raise } from "../support/compositor";
import { shellReady } from "../support/desk";
import { byId, deskNow, run, windowUntil } from "../support/windows";

interface Text {
  value: string;
  start: number;
  end: number;
}

interface Mods {
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
}

type Control = "field" | "area";

const mac = process.platform === "darwin";

/** A control's value and selection, read in the surface's own page. */
const read = (id: Control) =>
  inSurface<Text>(
    INPUT,
    `(() => { const c = document.querySelector('[data-testid=${id}]');
      return { value: c.value, start: c.selectionStart, end: c.selectionEnd }; })()`,
  );

/** Select from `start` to `end` in a control, from the page. */
const select = (id: Control, start: number, end: number) =>
  inSurface<boolean>(
    INPUT,
    `(document.querySelector('[data-testid=${id}]').setSelectionRange(${start}, ${end}), true)`,
  );

/** Set a control's text and caret from the page: the keys under test come after. */
const put = (id: Control, value: string, caret: number) =>
  inSurface<boolean>(
    INPUT,
    `(() => { const c = document.querySelector('[data-testid=${id}]');
      c.value = ${JSON.stringify(value)}; c.setSelectionRange(${caret}, ${caret});
      return true; })()`,
  );

/** The control's state once it matches `want`, or the last one read after five seconds. */
async function settled(id: Control, want: Partial<Text>): Promise<Text> {
  const matches = (t: Text) => Object.entries(want).every(([k, v]) => t[k as keyof Text] === v);
  let last = await read(id);
  for (const until = Date.now() + 5_000; !matches(last) && Date.now() < until; ) {
    await browser.pause(100);
    last = await read(id);
  }
  return last;
}

/** The DOM code of a character typed on a US layout. */
const codeOf = (ch: string) =>
  ch === " " ? "Space" : /\d/.test(ch) ? `Digit${ch}` : `Key${ch.toUpperCase()}`;

/** Type `text` key by key. */
const type = (text: string) => feed([...text].flatMap((ch) => keyPress(ch, codeOf(ch), ch)));

/** A chord in one turn of the event loop: the modifiers down, the key pressed, the modifiers up. */
const chord = (mods: Mods, key: string, code = key) =>
  feed([{ type: "modifiers", ...mods }, ...keyPress(key, code), { type: "modifiers" }]);

/** The input fixture's window. */
const WINDOW = "e2e.input";

/** A point of control `id`, a point of the input surface's own: `dx` in from the control's left
 * (from its right when negative), at its middle. */
async function spot(id: string, dx: number): Promise<[number, number]> {
  const [x = 0, y = 0, w = 0, h = 0] = await inSurface<number[]>(
    INPUT,
    `(() => { const r = document.querySelector('[data-testid=${id}]').getBoundingClientRect();
      return [r.x, r.y, r.width, r.height]; })()`,
  );
  return [dx >= 0 ? x + dx : x + w + dx, y + h / 2];
}

/** A click of `button` at `local`, a point of the input surface's own, once the surface (no bar of
 * the desk over it) hears the pointer there. */
async function pressAt(local: [number, number], button: "left" | "right"): Promise<void> {
  const at = await raise(INPUT, local);
  await feed([{ type: "pointerMoved", x: at[0], y: at[1] }]);
  const hearing = (await inputState()).pointer.hearing;
  if (!hearing.includes(INPUT)) {
    throw new Error(`${INPUT}'s point ${local} is under ${hearing.join(", ")}`);
  }
  await feed([
    { type: "pointerButton", button, pressed: true },
    { type: "pointerButton", button, pressed: false },
  ]);
}

const clickAt = (local: [number, number]) => pressAt(local, "left");
const rightClickAt = (local: [number, number]) => pressAt(local, "right");

/** The field menu as the input surface's page shows it: each row's label, top, height and state,
 * and its box. */
interface FieldMenu {
  rows: Array<[string, number, number, boolean]>;
  rect: [number, number, number, number];
}

const fieldMenu = () =>
  inSurface<FieldMenu | null>(
    INPUT,
    `(() => { const m = document.querySelector('desk-field-menu');
      if (!m || !m.matches(':popover-open')) return null;
      const r = m.getBoundingClientRect();
      return { rows: JSON.parse(m.dataset.rows), rect: [r.x, r.y, r.width, r.height] }; })()`,
  );

async function shownMenu(): Promise<FieldMenu> {
  let menu: FieldMenu | null = null;
  await browser.waitUntil(
    async () => {
      menu = await fieldMenu();
      return menu !== null;
    },
    { timeout: 5_000, timeoutMsg: "no field menu" },
  );
  return menu as unknown as FieldMenu;
}

const menuGone = (what: string) =>
  browser.waitUntil(async () => (await fieldMenu()) === null, {
    timeout: 5_000,
    timeoutMsg: `the field menu stayed after ${what}`,
  });

/** Click the field menu's row `label`. */
async function choose(label: string): Promise<void> {
  const menu = await shownMenu();
  const row = menu.rows.find(([name]) => name === label);
  if (!row) throw new Error(`no ${label} in the field menu`);
  const [x, y] = menu.rect;
  await clickAt([x + 40, y + row[1] + row[2] / 2]);
}

/** The clipboard's events the page heard. */
const clipEvents = async () =>
  (await inSurface<Array<{ type: string }>>(INPUT, "window.e2eInput.events"))
    .map((e) => e.type)
    .filter((t) => ["copy", "cut", "paste"].includes(t));

/** The system clipboard's text (macOS). */
const clipboard = () => execFileSync("pbpaste", { encoding: "utf8" });

before(async () => {
  await shellReady();
  await browser.waitUntil(
    async () =>
      (await inSurface<string>(
        INPUT,
        "document.querySelector('[data-testid=ready]').textContent",
      )) === "ready",
    { timeout: 20_000, timeoutMsg: "the input plugin never mounted" },
  );
  await feed([{ type: "windowFocused", focused: true }]);
  // The window in use fills the app, so no first layout decides what of it shows.
  await browser.waitUntil(
    async () => {
      await run("desk.display.show", { plugin: WINDOW });
      return byId(await deskNow(), WINDOW)?.focused === true;
    },
    { timeout: 15_000, interval: 300, timeoutMsg: `${WINDOW} is not shown and in use` },
  );
  await run("desk.display.maximize");
  await windowUntil(WINDOW, (w) => w.state === "filled", "filling the app");
  await inSurface<boolean>(INPUT, "(document.body.dataset.layout = 'middle', true)");
});

(mac ? describe : describe.skip)(
  "editing: the Mac's editing keys and the clipboard in a plugin's text field",
  () => {
    before(async () => {
      await clickAt(await spot("field", 20));
      await put("field", "", 0);
      await type("abc def");
      expect(await settled("field", { value: "abc def" })).toMatchObject({ value: "abc def" });
    });

    it("⌘← and ⌘→ go to the line's ends, their Shift forms select to them, ⌘A selects it all", async () => {
      await chord({ meta: true }, "ArrowLeft");
      expect(await settled("field", { start: 0, end: 0 })).toEqual({
        value: "abc def",
        start: 0,
        end: 0,
      });
      await chord({ meta: true }, "ArrowRight");
      expect(await settled("field", { start: 7, end: 7 })).toMatchObject({ start: 7, end: 7 });
      await chord({ meta: true, shift: true }, "ArrowLeft");
      expect(await settled("field", { start: 0, end: 7 })).toMatchObject({ start: 0, end: 7 });
      await chord({ meta: true }, "ArrowLeft");
      await chord({ meta: true, shift: true }, "ArrowRight");
      expect(await settled("field", { start: 0, end: 7 })).toMatchObject({ start: 0, end: 7 });
      await chord({ meta: true }, "ArrowRight");
      await chord({ meta: true }, "a", "KeyA");
      expect(await settled("field", { start: 0, end: 7 })).toMatchObject({ start: 0, end: 7 });
    });

    it("⌃A and ⌃E go to the line's start and end", async () => {
      await chord({ ctrl: true }, "a", "KeyA");
      expect(await settled("field", { start: 0, end: 0 })).toMatchObject({ start: 0, end: 0 });
      await chord({ ctrl: true }, "e", "KeyE");
      expect(await settled("field", { start: 7, end: 7 })).toMatchObject({ start: 7, end: 7 });
    });

    it("⌘Z brings back the word ⌥⌫ took, ⇧⌘Z takes it again, ⌘⌫ empties the line", async () => {
      await chord({ alt: true }, "Backspace");
      expect(await settled("field", { value: "abc " })).toMatchObject({ value: "abc " });
      await chord({ meta: true }, "z", "KeyZ");
      expect(await settled("field", { value: "abc def" })).toMatchObject({ value: "abc def" });
      await chord({ meta: true, shift: true }, "z", "KeyZ");
      expect(await settled("field", { value: "abc " })).toMatchObject({ value: "abc " });
      await chord({ meta: true }, "z", "KeyZ");
      expect(await settled("field", { value: "abc def" })).toMatchObject({ value: "abc def" });
      await chord({ meta: true }, "ArrowRight");
      await chord({ meta: true }, "Backspace");
      expect(await settled("field", { value: "" })).toMatchObject({ value: "", start: 0 });
      await chord({ meta: true }, "z", "KeyZ");
      expect(await settled("field", { value: "abc def" })).toMatchObject({ value: "abc def" });
    });

    it("⌘↑ and ⌘↓ go to a text area's ends, ⇧⌘↑ selects to its start", async () => {
      await clickAt(await spot("area", 20));
      await put("area", "one\ntwo\nthree", 5);
      await chord({ meta: true }, "ArrowDown");
      expect(await settled("area", { start: 13, end: 13 })).toMatchObject({ start: 13, end: 13 });
      await chord({ meta: true }, "ArrowUp");
      expect(await settled("area", { start: 0, end: 0 })).toMatchObject({ start: 0, end: 0 });
      await chord({ meta: true }, "ArrowDown");
      await chord({ meta: true, shift: true }, "ArrowUp");
      expect(await settled("area", { start: 0, end: 13 })).toMatchObject({ start: 0, end: 13 });
    });

    it("⌘C, ⌘X and ⌘V go through the system clipboard", async () => {
      const kept = clipboard();
      try {
        await clickAt(await spot("field", 20));
        await put("field", "", 0);
        await type("copy me");
        expect(await settled("field", { value: "copy me" })).toMatchObject({ value: "copy me" });
        await chord({ meta: true }, "ArrowRight");
        await chord({ alt: true, shift: true }, "ArrowLeft");
        expect(await settled("field", { start: 5, end: 7 })).toMatchObject({ start: 5, end: 7 });
        await chord({ meta: true }, "c", "KeyC");
        await browser.waitUntil(async () => clipboard() === "me", {
          timeout: 5_000,
          timeoutMsg: "⌘C put nothing on the clipboard",
        });
        await chord({ meta: true }, "ArrowLeft");
        await chord({ meta: true }, "v", "KeyV");
        expect(await settled("field", { value: "mecopy me" })).toMatchObject({
          value: "mecopy me",
        });
        await chord({ meta: true }, "a", "KeyA");
        await chord({ meta: true }, "x", "KeyX");
        expect(await settled("field", { value: "" })).toMatchObject({ value: "" });
        expect(clipboard()).toBe("mecopy me");
        await chord({ meta: true }, "v", "KeyV");
        expect(await settled("field", { value: "mecopy me" })).toMatchObject({
          value: "mecopy me",
        });
        const events = await inSurface<Array<{ type: string }>>(INPUT, "window.e2eInput.events");
        const clip = events.map((e) => e.type).filter((t) => ["copy", "cut", "paste"].includes(t));
        expect(clip).toEqual(["copy", "paste", "cut", "paste"]);
      } finally {
        execFileSync("pbcopy", { input: kept });
      }
    });

    it("a page that cancels a chord keeps it: ⌘A selects nothing there", async () => {
      await inSurface<boolean>(INPUT, "(window.e2eInput.cancel = ['KeyA'], true)");
      try {
        await chord({ meta: true }, "ArrowRight");
        expect(await settled("field", { start: 9, end: 9 })).toMatchObject({ start: 9, end: 9 });
        const before = (await inSurface<unknown[]>(INPUT, "window.e2eInput.events")).length;
        await chord({ meta: true }, "a", "KeyA");
        await browser.waitUntil(
          async () => {
            const after = await inSurface<Array<{ type: string; key?: string }>>(
              INPUT,
              `window.e2eInput.events.slice(${before})`,
            );
            return after.some((e) => e.type === "keyup" && e.key === "a");
          },
          { timeout: 5_000, timeoutMsg: "⌘A never reached the page" },
        );
        expect(await read("field")).toMatchObject({ start: 9, end: 9 });
      } finally {
        await inSurface<boolean>(INPUT, "(window.e2eInput.cancel = [], true)");
      }
    });
  },
);

describe("editing: a right click in a text field opens the field menu", () => {
  // The menu's Copy and Paste go through the system clipboard: give back what was on it (macOS).
  let kept: string | undefined;
  before(() => {
    if (mac) kept = clipboard();
  });
  after(() => {
    if (kept !== undefined) execFileSync("pbcopy", { input: kept });
  });

  it("offers Undo, Redo, Cut, Copy, Paste and Select All; its Copy and Paste go through the clipboard", async () => {
    await clickAt(await spot("field", 20));
    await put("field", "copy me", 7);
    await select("field", 0, 7);
    await rightClickAt(await spot("field", 20));
    const menu = await shownMenu();
    expect(menu.rows.map(([label]) => label)).toEqual([
      "Undo",
      "Redo",
      "-",
      "Cut",
      "Copy",
      "Paste",
      "-",
      "Select All",
    ]);
    const on = menu.rows.filter(([, , , enabled]) => enabled).map(([label]) => label);
    expect(on).toEqual(expect.arrayContaining(["Cut", "Copy", "Paste", "Select All"]));
    const heard = (await clipEvents()).length;
    await choose("Copy");
    await menuGone("Copy");
    expect((await clipEvents()).slice(heard)).toEqual(["copy"]);
    await select("field", 7, 7);
    await rightClickAt(await spot("field", -20));
    await choose("Paste");
    await menuGone("Paste");
    expect(await settled("field", { value: "copy mecopy me" })).toMatchObject({
      value: "copy mecopy me",
    });
    await rightClickAt(await spot("field", -20));
    await choose("Select All");
    expect(await settled("field", { start: 0, end: 14 })).toMatchObject({ start: 0, end: 14 });
  });

  it("Escape puts the menu away, and the field keeps the keys", async () => {
    await select("field", 14, 14);
    await rightClickAt(await spot("field", -20));
    await shownMenu();
    await feed(keyPress("Escape", "Escape"));
    await menuGone("Escape");
    await type("x");
    expect(await settled("field", { value: "copy mecopy mex" })).toMatchObject({
      value: "copy mecopy mex",
    });
  });

  it("a page that draws its own menu keeps it, and nothing to edit or copy opens none", async () => {
    const before = (await inSurface<unknown[]>(INPUT, "window.e2eInput.events")).length;
    await rightClickAt(await spot("custom", -30));
    await browser.waitUntil(
      async () =>
        (
          await inSurface<Array<{ type: string }>>(INPUT, `window.e2eInput.events.slice(${before})`)
        ).some((e) => e.type === "contextmenu"),
      { timeout: 5_000, timeoutMsg: "the page never heard its right click" },
    );
    await rightClickAt(await spot("drop", -15));
    await browser.pause(500);
    expect(await fieldMenu()).toBeNull();
  });
});
