// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { placeMenu } from "../ui/context-menu.js";
import type { Row } from "../ui/tree.js";
import { createView } from "../ui/view.js";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const rows: Row[] = ["a.md", "b.md"].map((name) => ({
  id: `/${name}`,
  path: `/${name}`,
  name,
  kind: "file",
  depth: 0,
  root: "/",
  hidden: false,
}));
const context = vi.fn();
let view: ReturnType<typeof createView>;
let select = vi.fn<(id: string) => void>();
beforeEach(() => {
  document.documentElement.innerHTML = html
    .replace(/^<!doctype html>\s*<html[^>]*>/i, "")
    .replace(/<\/html>\s*$/, "");
  context.mockReset();
  select = vi.fn((id: string) => view.selection(id));
  view = createView(
    document,
    Object.assign(
      {
        select,
        activate: vi.fn(),
        key: vi.fn(),
        type: () => false,
        addFolder: vi.fn(),
        newFile: vi.fn(),
        refresh: vi.fn(),
        toggleHidden: vi.fn(),
        togglePreview: vi.fn(),
      },
      { context },
    ),
  );
  view.tree(rows, "/a.md");
  view.focus("/a.md");
});
const items = () => [...document.querySelectorAll<HTMLElement>("[role=treeitem]")];
const menu = () => document.querySelector<HTMLElement>("[role=menu]");
const key = (target: Element, name: string, shiftKey = false) => {
  const event = new KeyboardEvent("keydown", {
    key: name,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
};

describe("Explorer context menu", () => {
  it("right click selects the target and opens nine named menu actions", () => {
    items()[1]?.dispatchEvent(
      new MouseEvent("contextmenu", {
        clientX: 300,
        clientY: 200,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(select).toHaveBeenCalledWith("/b.md");
    expect(menu()?.hidden).toBe(false);
    const entries = [...document.querySelectorAll("[role=menuitem]")];
    expect(entries.map((item) => item.textContent)).toEqual([
      "Open",
      "Open terminal here",
      "Git status here",
      "Show in system file manager",
      "Copy path",
      "New file",
      "New folder",
      "Rename",
      "Move to Trash",
    ]);
    expect(entries.map((item) => item.getAttribute("aria-keyshortcuts"))).toEqual([
      ...Array(7).fill(null),
      "F2",
      "Delete Meta+Backspace",
    ]);
    expect(document.activeElement?.textContent).toBe("Open");
  });

  it("F2 renames the selection, Delete and Mod+Backspace move it to the Trash; other chords pass to the desk", () => {
    const row = items()[0] as HTMLElement;
    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
      row.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press({ key: "F2" })).toBe(true);
    expect(press({ key: "Delete" })).toBe(true);
    expect(press({ key: "Backspace", metaKey: true })).toBe(true);
    expect(context.mock.calls).toEqual([
      ["endue.explorer.rename"],
      ["endue.explorer.trash"],
      ["endue.explorer.trash"],
    ]);
    for (const chord of [
      { key: "Backspace" },
      { key: "Backspace", ctrlKey: true },
      { key: "Backspace", metaKey: true, shiftKey: true },
      { key: "F2", altKey: true },
      { key: "N", metaKey: true, shiftKey: true },
    ])
      expect(press(chord), JSON.stringify(chord)).toBe(false);
    expect(context).toHaveBeenCalledTimes(3);
    expect(menu()?.hidden).toBe(true);
  });

  it("Shift+F10 targets the selection, arrows navigate and Enter runs exactly one command", () => {
    expect(key(items()[0] as HTMLElement, "F10", true).defaultPrevented).toBe(true);
    expect(menu()?.hidden).toBe(false);
    key(document.activeElement as Element, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("Open terminal here");
    key(document.activeElement as Element, "Enter");
    expect(context).toHaveBeenCalledExactlyOnceWith("endue.explorer.terminal-here");
    expect(menu()?.hidden).toBe(true);
    expect(document.activeElement).toBe(items()[0]);
  });

  it("Escape restores tree focus and desk chords pass through", () => {
    key(items()[0] as HTMLElement, "F10", true);
    expect(menu()?.hidden).toBe(false);
    const chord = new KeyboardEvent("keydown", {
      key: "p",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.activeElement?.dispatchEvent(chord);
    expect(chord.defaultPrevented).toBe(false);
    expect(key(document.activeElement as Element, "Escape").defaultPrevented).toBe(true);
    expect(menu()?.hidden).toBe(true);
    expect(document.activeElement).toBe(items()[0]);
    expect(context).not.toHaveBeenCalled();
  });

  it("opens beside the press where it fits, else on the other side, else inside the page", () => {
    const menu = { width: 200, height: 230 };
    const page = { width: 400, height: 263 };
    // Room right of and below the press: there.
    expect(placeMenu({ x: 20, y: 20 }, menu, { width: 400, height: 600 })).toEqual({
      left: 20,
      top: 20,
    });
    // No room right or below: left of it and above it (a row's top edge for the keyboard).
    expect(placeMenu({ x: 380, y: 590, top: 570 }, menu, { width: 400, height: 600 })).toEqual({
      left: 180,
      top: 340,
    });
    // Room on neither side: as far up or left as keeps it whole, 6 px from the edge.
    expect(placeMenu({ x: 150, y: 113 }, { width: 300, height: 230 }, page)).toEqual({
      left: 94,
      top: 27,
    });
    // Larger than the page: from its top-left margin (the menu scrolls there).
    expect(placeMenu({ x: 10, y: 10 }, { width: 500, height: 300 }, page)).toEqual({
      left: 6,
      top: 6,
    });
  });

  it("refreshing the tree closes the stale menu and keeps keyboard focus on the selection", () => {
    key(items()[0] as HTMLElement, "F10", true);
    expect(menu()?.hidden).toBe(false);
    view.tree(rows, "/a.md");
    expect(menu()?.hidden).toBe(true);
    expect(document.activeElement).toBe(items()[0]);
  });
});
