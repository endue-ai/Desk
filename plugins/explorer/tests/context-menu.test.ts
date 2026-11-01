// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  it("right click selects the target and opens four named menu actions", () => {
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
    expect(
      [...document.querySelectorAll("[role=menuitem]")].map((item) => item.textContent),
    ).toEqual(["Open", "Open terminal here", "Git status here", "Show in system file manager"]);
    expect(document.activeElement?.textContent).toBe("Open");
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

  it("refreshing the tree closes the stale menu and keeps keyboard focus on the selection", () => {
    key(items()[0] as HTMLElement, "F10", true);
    expect(menu()?.hidden).toBe(false);
    view.tree(rows, "/a.md");
    expect(menu()?.hidden).toBe(true);
    expect(document.activeElement).toBe(items()[0]);
  });
});
