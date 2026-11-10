// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  armProbe,
  type Probe,
  paletteShown,
  pressUntilTimed,
  readProbe,
  takeKeyboard,
} from "./probe";

/**
 * A page-side function as browser.execute sends it: rebuilt from its own source in the page's
 * global scope, so a name it borrowed from the module would not be there. webdriverio defines
 * `__name` first (the helper tsx's keepNames calls), and so does this.
 */
// biome-ignore lint/complexity/noBannedTypes: any page-side function, as browser.execute takes it
const inPage = <F extends Function>(fn: F): F =>
  new Function(`var __name = (target) => target; return (${fn.toString()})`)() as F;

/** The page's animation frames, run by hand. */
let frames: FrameRequestCallback[] = [];
const tick = (time: number) => {
  for (const callback of frames.splice(0)) callback(time);
};
const probe = () => inPage(readProbe)();

/** A keydown in the shell page that the page got at `timeStamp`. */
function key(name: string, timeStamp?: number) {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true });
  if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
  document.body.dispatchEvent(event);
}

/** A key a plugin surface forwarded to the desk (plugin-sdk's desk:key), from its host. */
function forwarded(host: string, name: string) {
  const data = { type: "desk:key", key: { key: name, ctrlKey: true } };
  window.dispatchEvent(new MessageEvent("message", { data, origin: `desk-plugin://${host}` }));
}

const NOTES = "main.desk-notes";
const PAGE = `
  <section class="desk-surface" data-surface="desk.notes" tabindex="-1"><div data-surface-host="${NOTES}" tabindex="-1"></div></section>
  <section class="desk-surface desk-surface--overlay" data-surface="desk.palette" hidden></section>`;
const section = (id: string) =>
  document.querySelector<HTMLElement>(`.desk-surface[data-surface="${id}"]`) as HTMLElement;
const notesFrame = () => section("desk.notes").querySelector("[data-surface-host]") as HTMLElement;

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.spyOn(performance, "now").mockReturnValue(1000);
  document.body.removeAttribute("tabindex");
  document.body.innerHTML = PAGE;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as unknown as { __deskProbe?: Probe }).__deskProbe;
});

describe("the input-latency probe in the shell page", () => {
  it("takes the keyboard from a plugin surface's place onto the shell page's body", () => {
    notesFrame().focus();
    expect(document.activeElement).toBe(notesFrame());
    expect(inPage(takeKeyboard)()).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(document.body.hasAttribute("tabindex")).toBe(false);

    // A body that is focusable already stays so; a place that keeps the keyboard is named.
    document.body.tabIndex = 0;
    expect(inPage(takeKeyboard)()).toBeNull();
    expect(document.body.getAttribute("tabindex")).toBe("0");
    notesFrame().focus();
    vi.spyOn(document.body, "focus").mockImplementation(() => {});
    expect(inPage(takeKeyboard)()).toBe("desk.notes");
  });

  it("times a key from its keydown in the shell page to the frame after the palette's surface shows", () => {
    inPage(armProbe)("palette");
    key("Control");
    expect(frames).toHaveLength(0);
    key("k", 990);
    tick(1016);
    expect(probe()).toEqual({});
    section("desk.palette").hidden = false;
    tick(1033);
    expect(probe()).toEqual({});
    tick(1050);
    expect(probe()).toEqual({ ms: 60 });

    // One key is timed: the next one is not heard.
    key("k", 2000);
    expect(frames).toHaveLength(0);
  });

  it("times the focus switch from the key to the frame after the focus moved", () => {
    inPage(takeKeyboard)();
    inPage(armProbe)("focus");
    key("Shift");
    key("Tab");
    tick(1016);
    section("desk.notes").focus();
    tick(1033);
    tick(1040);
    // A keydown stamped on another clock is timed from when the page handled it.
    expect(probe()).toEqual({ ms: 40 });
  });

  it("names the surface a key reached the page through, and times nothing", () => {
    inPage(armProbe)("palette");
    window.dispatchEvent(new MessageEvent("message", { data: { type: "desk:calls", calls: [] } }));
    forwarded(NOTES, "Control");
    forwarded(NOTES, "k");
    tick(1016);
    expect(probe()).toEqual({});
    section("desk.palette").hidden = false;
    tick(1033);
    tick(1050);
    expect(probe()).toEqual({ frame: "desk.notes" });

    key("k", 1060);
    expect(frames).toHaveLength(0);
    expect(probe()).toEqual({ frame: "desk.notes" });
  });

  it("says whether the palette's surface is shown", () => {
    expect(inPage(paletteShown)()).toBe(false);
    section("desk.palette").hidden = false;
    expect(inPage(paletteShown)()).toBe(true);
    document.body.innerHTML = "";
    expect(inPage(paletteShown)()).toBe(false);
  });
});

describe("a key that went to a frame instead of the shell page", () => {
  const presses = (...probes: Probe[]) => {
    const press = vi.fn(async () => probes.shift() ?? {});
    return press;
  };

  it("presses a key again when it went through a frame, at most twice, then fails naming the frame", async () => {
    expect(await pressUntilTimed(presses({ ms: 12.5 }), "Control+k (try 1)")).toEqual({
      ms: 12.5,
      throughFrames: [],
    });

    const twice = presses({ frame: "desk.notes" }, { frame: "desk.today" }, { ms: 30 });
    expect(await pressUntilTimed(twice, "Control+k (try 2)")).toEqual({
      ms: 30,
      throughFrames: ["desk.notes", "desk.today"],
    });
    expect(twice).toHaveBeenCalledTimes(3);

    const always = presses(
      { frame: "desk.notes" },
      { frame: "desk.notes" },
      { frame: "desk.notes" },
    );
    await expect(pressUntilTimed(always, "Control+k (try 3)")).rejects.toThrow(
      "Control+k (try 3): the key went to desk.notes's frame, not the shell page, 3 times",
    );
    expect(always).toHaveBeenCalledTimes(3);
  });
});
