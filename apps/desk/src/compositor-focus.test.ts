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
    const stop = startCompositorFocus(window, (focus) => sent.push(focus));
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
    stop();
    focus(notes);
    await tick();
    expect(sent).toHaveLength(4);
  });
});
