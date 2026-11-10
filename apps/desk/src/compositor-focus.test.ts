// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { focusedSurface, startCompositorFocus } from "./compositor-focus";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

afterEach(() => {
  document.body.innerHTML = "";
});

/** Focus `el` and say so as a browser does (jsdom fires no focus events for a frame). */
function focus(el: HTMLElement) {
  el.focus();
  el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}

function frame(src: string): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.src = src;
  document.body.append(iframe);
  return iframe;
}

describe("the page's focus report (#56)", () => {
  it("names the plugin surface whose stand-in has the focus, and none for the page's own", () => {
    const notes = frame("desk-plugin://main.endue-notes/endue.notes/ui/index.html");
    const palette = frame("desk-plugin://localhost/_desk/palette/index.html");
    const input = document.createElement("input");
    document.body.append(input);
    notes.focus();
    expect(focusedSurface(document)).toBe("main.endue-notes");
    palette.focus();
    expect(focusedSurface(document), "not a plugin surface's").toBeNull();
    input.focus();
    expect(focusedSurface(document)).toBeNull();
  });

  it("says where the focus settled, once per move", async () => {
    const notes = frame("desk-plugin://main.endue-notes/endue.notes/ui/index.html");
    const files = frame("desk-plugin://main.endue-files/endue.files/ui/index.html");
    const input = document.createElement("input");
    document.body.append(input);
    const sent: Array<string | null> = [];
    const stop = startCompositorFocus(window, (surface) => sent.push(surface));
    focus(notes);
    await tick();
    // Out of one frame and into the next in one move: only where it lands is said.
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

  it("hears Tab put the focus in a stand-in of another process, which says so only by a blur (#123)", async () => {
    const notes = frame("desk-plugin://main.endue-notes/endue.notes/ui/index.html");
    const input = document.createElement("input");
    document.body.append(input);
    const sent: Array<string | null> = [];
    const stop = startCompositorFocus(window, (surface) => sent.push(surface));
    focus(input);
    await tick();
    // The page's element lets the focus go, and the frame takes it once its process answers.
    input.blur();
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await tick();
    notes.focus();
    window.dispatchEvent(new FocusEvent("blur"));
    await tick();
    expect(sent).toEqual([null, "main.endue-notes"]);
    stop();
  });
});
