// @vitest-environment jsdom
// Asking for a surface and following the window manager are two things (ADR 0230): only asking
// reaches the window host, so a desk the page is told can never ask the window manager back.
import { afterEach, describe, expect, it, vi } from "vitest";
import { surfaceFocus } from "./focus-surface";
import type { ShortcutRouter } from "./input";
import type { SurfaceHost } from "./surfaces";

afterEach(() => document.body.replaceChildren());

function desk() {
  const root = document.createElement("div");
  document.body.append(root);
  const place = document.createElement("div");
  place.tabIndex = -1;
  root.append(place);
  const shortcuts = { focused: null as string | null, focus: vi.fn() };
  shortcuts.focus.mockImplementation((id: string | null) => {
    shortcuts.focused = id;
  });
  const surfaces = { focus: vi.fn(() => place.focus()) };
  const show = vi.fn(() => Promise.resolve(["shown"]));
  const moved = vi.fn();
  const focus = surfaceFocus({
    root,
    shortcuts: shortcuts as unknown as ShortcutRouter,
    surfaces: surfaces as unknown as SurfaceHost,
    show,
    moved,
  });
  return { root, place, shortcuts, surfaces, show, moved, focus };
}

describe("giving a surface the focus", () => {
  it("asking reaches the window host, and settles when it says", async () => {
    const d = desk();
    const asked = d.focus.focus("p.a");
    expect(d.show).toHaveBeenCalledWith("p.a");
    expect(document.activeElement).toBe(d.place);
    expect(await asked).toEqual(["shown"]);
    expect(d.focus.focus(null)).toBeUndefined();
    expect(d.shortcuts.focused).toBeNull();
  });

  it("following moves the page's focus and asks for nothing", () => {
    const d = desk();
    d.focus.follow("p.a");
    expect(d.show).not.toHaveBeenCalled();
    expect(d.shortcuts.focused).toBe("p.a");
    expect(d.moved).toHaveBeenCalledWith("p.a");
    expect(document.activeElement).toBe(d.place);
  });

  it("a window the window manager put in use unasked leaves an overlay with the page's focus alone", () => {
    const d = desk();
    const overlay = document.createElement("section");
    overlay.className = "desk-surface desk-surface--overlay";
    const answer = document.createElement("button");
    overlay.append(answer);
    d.root.append(overlay);
    answer.focus();
    d.focus.follow("p.a", true);
    expect(document.activeElement).toBe(answer);
    expect(d.shortcuts.focus).not.toHaveBeenCalled();
    // Hidden, it holds nothing.
    overlay.hidden = true;
    d.focus.follow("p.a", true);
    expect(document.activeElement).toBe(d.place);
    // A move the runtime asked for takes the focus from an overlay, as it always did (a command
    // the palette ran).
    overlay.hidden = false;
    answer.focus();
    d.focus.follow("p.a");
    expect(document.activeElement).toBe(d.place);
  });

  it("a pane of the page's own put in use unasked takes the focus from a field outside every window", () => {
    const d = desk();
    const line = document.createElement("input");
    const window = document.createElement("section");
    window.className = "surface";
    const field = document.createElement("input");
    window.append(field);
    d.root.append(line, window);
    line.focus();
    d.focus.follow(null);
    expect(document.activeElement, "a move the runtime asked for").toBe(line);
    d.focus.follow(null, true);
    expect(document.activeElement).toBe(document.body);
    // A field of the window in use keeps it.
    field.focus();
    d.focus.follow(null, true);
    expect(document.activeElement).toBe(field);
  });
});
