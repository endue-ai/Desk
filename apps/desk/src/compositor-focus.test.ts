// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  focusedSurface,
  type PageFocus,
  pageFocus,
  startCompositorFocus,
} from "./compositor-focus";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

afterEach(() => {
  document.body.innerHTML = "";
});

/** Focus `el` and say so as a browser does. */
function focus(el: HTMLElement) {
  el.focus();
  el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}

/** A plugin surface's place in its section, with its two Tab edges (ADR 0160). */
function place(host: string): { section: HTMLElement; place: HTMLElement; edge: HTMLElement } {
  const section = document.createElement("section");
  section.dataset.surface = host.split(".")[1] ?? host;
  section.tabIndex = -1;
  const place = document.createElement("div");
  place.dataset.surfaceHost = host;
  place.tabIndex = -1;
  const edge = document.createElement("span");
  edge.tabIndex = 0;
  place.append(edge);
  section.append(place);
  document.body.append(section);
  return { section, place, edge };
}

describe("the page's focus report (#56)", () => {
  it("names the plugin surface whose place has the focus, and none for the page's own", () => {
    const notes = place("main.endue-notes");
    const input = document.createElement("input");
    document.body.append(input);
    notes.place.focus();
    expect(focusedSurface(document)).toBe("main.endue-notes");
    notes.edge.focus();
    expect(focusedSurface(document), "an edge of the place").toBe("main.endue-notes");
    notes.section.focus();
    expect(focusedSurface(document), "the section has no place of its own").toBeNull();
    input.focus();
    expect(focusedSurface(document)).toBeNull();
  });

  it("tells an element of the page's own from nothing of its own, where the keys follow the window in use", () => {
    const notes = place("main.endue-notes");
    const input = document.createElement("input");
    const button = document.createElement("button");
    document.body.append(input, button);
    const rest: PageFocus = { surface: null, own: false };
    expect(pageFocus(document), "the body").toEqual(rest);
    notes.place.focus();
    expect(pageFocus(document)).toEqual({ surface: "main.endue-notes", own: false });
    notes.section.focus();
    expect(pageFocus(document), "a window's or a surface's section").toEqual(rest);
    input.focus();
    expect(pageFocus(document), "a field").toEqual({ surface: null, own: true });
    button.focus();
    expect(pageFocus(document), "a button").toEqual({ surface: null, own: true });
    button.blur();
    expect(pageFocus(document), "a closed palette leaves the body").toEqual(rest);
  });

  it("says where the focus settled, once per move", async () => {
    const notes = place("main.endue-notes").place;
    const files = place("main.endue-files").place;
    const input = document.createElement("input");
    document.body.append(input);
    const sent: PageFocus[] = [];
    const reporter = startCompositorFocus(window, (focus) => sent.push(focus));
    focus(notes);
    await tick();
    // Out of one place and into the next in one move: only where it lands is said.
    notes.blur();
    notes.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    focus(files);
    await tick();
    focus(input);
    await tick();
    focus(input);
    await tick();
    input.blur();
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await tick();
    expect(sent).toEqual([
      { surface: "main.endue-notes", own: false },
      { surface: "main.endue-files", own: false },
      { surface: null, own: true },
      { surface: null, own: false },
    ]);
    reporter.stop();
    focus(notes);
    await tick();
    expect(sent).toHaveLength(4);
  });
});

describe("the page's answers (what is typed waits for them in the compositor)", () => {
  const said: Array<[PageFocus, boolean]> = [];
  let reporter: ReturnType<typeof startCompositorFocus> | undefined;
  const start = () => {
    said.length = 0;
    reporter = startCompositorFocus(window, (focus, answer) => said.push([focus, answer]));
    return reporter;
  };
  afterEach(() => reporter?.stop());

  it("says a move by the end of the task that made it, before anything later runs", async () => {
    start();
    const input = document.createElement("input");
    document.body.append(input);
    let timer = false;
    setTimeout(() => {
      timer = true;
    }, 0);
    focus(input);
    await Promise.resolve();
    expect(timer, "no turn passed").toBe(false);
    expect(said).toEqual([[{ surface: null, own: true }, false]]);
  });

  it("answers a press once its release is handled, also when nothing moved", async () => {
    start();
    const input = document.createElement("input");
    document.body.append(input);
    // The talk pill's click opens its line and focuses it, after the pointer went up.
    window.addEventListener("click", () => focus(input), { once: true });
    window.dispatchEvent(new PointerEvent("pointerup"));
    window.dispatchEvent(new MouseEvent("click"));
    await tick();
    expect(said).toEqual([
      [{ surface: null, own: true }, false],
      [{ surface: null, own: true }, true],
    ]);
    // A press on the desk that moves nothing is answered all the same.
    window.dispatchEvent(new PointerEvent("pointerup"));
    await tick();
    expect(said.at(-1)).toEqual([{ surface: null, own: true }, true]);
  });

  it("answers a key the desk ran by the move its command made, or once it ran", async () => {
    const focusing = start();
    const palette = place("main.desk-palette").place;
    let shown = () => {};
    // ⌘K: the palette's place takes the page's focus while its command runs.
    focusing.ran(
      new Promise<void>((resolve) => {
        shown = resolve;
      }),
    );
    focus(palette);
    await Promise.resolve();
    expect(said).toEqual([[{ surface: "main.desk-palette", own: false }, true]]);
    shown();
    await tick();
    expect(said, "answered once").toHaveLength(1);
    // ⌘S: nothing moves; the answer comes once the save ran.
    focusing.ran(Promise.resolve(true));
    await tick();
    expect(said).toEqual([
      [{ surface: "main.desk-palette", own: false }, true],
      [{ surface: "main.desk-palette", own: false }, true],
    ]);
    // A command that failed is answered too.
    focusing.ran(Promise.reject(new Error("no")));
    await tick();
    expect(said).toHaveLength(3);
  });
});

describe("a window's own page's focus (ADR 0201)", () => {
  it("gives the keys to the window's page for a field of its own, to a plugin for its place", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const own = frame.contentWindow as Window;
    const doc = own.document;
    const field = doc.createElement("textarea");
    const place = doc.createElement("div");
    place.dataset.surfaceHost = "main.endue-terminal";
    place.tabIndex = -1;
    doc.body.append(field, place);
    const sent: Array<[PageFocus, boolean]> = [];
    const reporter = startCompositorFocus(window, (focus, answer) => sent.push([focus, answer]));
    const stop = reporter.watch(own, "local:claude");
    focus(field);
    await tick();
    focus(place);
    await tick();
    // A press there is answered, though the desk's page has not the engine's focus.
    own.dispatchEvent(new Event("pointerup"));
    await tick();
    expect(sent).toEqual([
      [{ surface: "window:local:claude", own: false }, false],
      [{ surface: "main.endue-terminal", own: false }, false],
      [{ surface: "main.endue-terminal", own: false }, true],
    ]);
    stop();
    reporter.stop();
  });
});
