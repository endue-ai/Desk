// The Mac's editing keys and the clipboard in an off-screen page (#156). Every page is an
// off-screen browser, which never hears AppKit's key bindings (⌘←, ⌘⌫, ⌃A ...) or the Edit menu's
// key equivalents (⌘A, ⌘C, ⌘X, ⌘V, ⌘Z, ⇧⌘Z), so the shell sends those keys down with the edit
// commands a windowed view would have given Blink (`apps/desk/shell/src/web_host/edit_keys.rs`).
// The keys are winit's, fed to the compositor window's own input entry (support/compositor.ts):
// the screen may be locked. macOS only: on Windows and Linux Blink binds Ctrl+A, Ctrl+C and the
// rest itself.
import { execFileSync } from "node:child_process";
import { browser, expect } from "@wdio/globals";
import { feed, INPUT, inSurface, keyPress, raise } from "../support/compositor";
import { shellReady } from "../support/desk";

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

/** Click at `local`, a point of the input surface's own. */
async function clickAt(local: [number, number]): Promise<void> {
  const at = await raise(INPUT, local);
  await feed([
    { type: "pointerMoved", x: at[0], y: at[1] },
    { type: "pointerButton", button: "left", pressed: true },
    { type: "pointerButton", button: "left", pressed: false },
  ]);
}

/** The system clipboard's text (macOS). */
const clipboard = () => execFileSync("pbpaste", { encoding: "utf8" });

(mac ? describe : describe.skip)(
  "editing: the Mac's editing keys and the clipboard in a plugin's text field",
  () => {
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
      await clickAt([20, 20]);
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
      await clickAt([20, 230]);
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
        await clickAt([20, 20]);
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
