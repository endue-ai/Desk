// Typing through the compositor (#56): the desk runs in compositor mode, so the input plugin
// (e2e/fixtures/plugin-e2e-input) is an off-screen browser and only the compositor's router puts
// keys and IME text into it. A click focuses its field; keys type; a Korean composition commits
// syllable by syllable, its candidate window placed at the field's caret; a chord the desk's keymap
// binds never reaches the field; the cursor follows the surface. The events are winit's, fed to
// the compositor window's own input entry (support/compositor.ts): the screen may be locked.
import { browser, expect } from "@wdio/globals";
import { feed, INPUT, inputState, inSurface, keyPress, raise } from "../support/compositor";
import { shellReady } from "../support/desk";

interface Seen {
  value: string;
  events: Array<{ type: string; key?: string; data?: string }>;
}

const seen = () => inSurface<Seen>(INPUT, "window.e2eInput");
const preedit = (text: string) => ({
  type: "ime",
  ime: "preedit",
  text,
  cursor: text ? [text.length * 3, text.length * 3] : null,
});

describe("ime: keys and a Korean composition reach a plugin's input through the compositor", () => {
  before(async () => {
    await shellReady();
    await browser.waitUntil(
      async () =>
        (await inSurface<string>(
          INPUT,
          "document.querySelector('[data-testid=ready]').textContent",
        )) === "ready",
      {
        timeout: 20_000,
        timeoutMsg: "the input plugin never mounted",
      },
    );
    await feed([{ type: "windowFocused", focused: true }]);
  });

  it("a click on the field focuses it, the OS IME turns on for it, and keys type into it", async () => {
    const field = await raise(INPUT, [20, 20]);
    await feed([
      { type: "pointerMoved", x: field[0], y: field[1] },
      { type: "pointerButton", button: "left", pressed: true },
      { type: "pointerButton", button: "left", pressed: false },
    ]);
    await browser.waitUntil(async () => (await inputState()).focused === INPUT, {
      timeoutMsg: "the field's surface never had the focus",
    });
    await browser.waitUntil(async () => (await inputState()).ime.allowed, {
      timeoutMsg: "the IME never turned on",
    });
    expect((await inputState()).cursor).toContain("Text");
    await feed([...keyPress("h", "KeyH", "h"), ...keyPress("i", "KeyI", "i")]);
    await browser.waitUntil(async () => (await seen()).value === "hi", {
      timeoutMsg: "the keys never typed",
    });
    const down = (await seen()).events.filter((e) => e.type === "keydown").map((e) => e.key);
    expect(down).toEqual(["h", "i"]);
  });

  it("한글 composes in the field syllable by syllable, the candidate window at its caret", async () => {
    await feed([{ type: "ime", ime: "enabled" }, preedit("ㅎ"), preedit("하"), preedit("한")]);
    await browser.waitUntil(async () => (await seen()).value === "hi한", {
      timeoutMsg: "the composition never showed",
    });
    const state = await inputState();
    expect(state.ime.composing).toEqual({ surface: INPUT, text: "한" });
    expect(state.ime.area?.length).toBe(4);
    await feed([
      preedit(""),
      { type: "ime", ime: "commit", text: "한" },
      preedit("ㄱ"),
      preedit("그"),
      preedit("글"),
    ]);
    await feed([preedit(""), { type: "ime", ime: "commit", text: "글" }]);
    await browser.waitUntil(async () => (await seen()).value === "hi한글", {
      timeoutMsg: "한글 never committed",
    });
    const composed = (await seen()).events
      .filter((e) => e.type.startsWith("composition"))
      .map((e) => `${e.type}:${e.data ?? ""}`);
    expect(composed).toEqual([
      "compositionstart:",
      "compositionupdate:ㅎ",
      "compositionupdate:하",
      "compositionupdate:한",
      "compositionend:한",
      "compositionstart:",
      "compositionupdate:ㄱ",
      "compositionupdate:그",
      "compositionupdate:글",
      "compositionend:글",
    ]);
  });

  it("the cursor follows the surface under the pointer: col-resize, then the image it drew", async () => {
    const resize = await raise(INPUT, [20, 110]);
    await feed([{ type: "pointerMoved", x: resize[0], y: resize[1] }]);
    await browser.waitUntil(async () => (await inputState()).cursor.includes("ColResize"), {
      timeoutMsg: "no col-resize cursor",
    });
    const custom = await raise(INPUT, [20, 160]);
    await feed([{ type: "pointerMoved", x: custom[0], y: custom[1] }]);
    await browser.waitUntil(async () => (await inputState()).cursor.includes("Image"), {
      timeoutMsg: "no image cursor",
    });
  });

  it("a chord the desk's keymap binds is the desk's: the field never hears it", async () => {
    const mod = process.platform === "darwin" ? { meta: true } : { ctrl: true };
    const before = (await seen()).events.length;
    await feed([
      { type: "modifiers", ...mod },
      ...keyPress("k", "KeyK", "k"),
      { type: "modifiers" },
    ]);
    // The palette took the focus: the compositor followed the page there.
    await browser.waitUntil(async () => (await inputState()).focused !== INPUT, {
      timeoutMsg: "the palette never took the focus",
    });
    const after = (await seen()).events.slice(before);
    expect(after.filter((e) => e.type === "keydown" && e.key === "k")).toEqual([]);
  });
});
