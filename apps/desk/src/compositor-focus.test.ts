// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { focusedSurface, startCompositorFocus } from "./compositor-focus";

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
    expect(focusedSurface(document), "the section is the page's, for Ctrl+Tab").toBeNull();
    input.focus();
    expect(focusedSurface(document)).toBeNull();
  });

  it("says where the focus settled, once per move", async () => {
    const notes = place("main.endue-notes").place;
    const files = place("main.endue-files").place;
    const input = document.createElement("input");
    document.body.append(input);
    const sent: Array<string | null> = [];
    const stop = startCompositorFocus(window, (surface) => sent.push(surface));
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
    expect(sent).toEqual(["main.endue-notes", "main.endue-files", null]);
    stop();
    focus(notes);
    await tick();
    expect(sent).toHaveLength(3);
  });
});
