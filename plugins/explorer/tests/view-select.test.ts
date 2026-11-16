// @vitest-environment jsdom
// The tree's DOM for several selected rows (#313): it says it is multi-select, a Shift- or Mod-click
// extends or toggles without opening, Shift+arrows and Mod+A/C/X/V/F reach the explorer, every
// selected row is aria-selected, and a drag from a selected row carries every selected path.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Row } from "../ui/tree.js";
import { createView } from "../ui/view.js";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const entry = (name: string, kind: Row["kind"] = "file"): Row => ({
  id: `~/notes/${name}`,
  path: `~/notes/${name}`,
  name,
  kind,
  depth: 1,
  root: "~/notes",
  hidden: false,
});
const rows = [entry("a.md"), entry("b.md"), entry("Old", "dir")];
type Draggable = { item(target: unknown): { items: unknown[] } | undefined };
let actions: Parameters<typeof createView>[1];
let draggable: Draggable | undefined;
let view: ReturnType<typeof createView>;
beforeEach(() => {
  document.documentElement.innerHTML = html
    .replace(/^<!doctype html>\s*<html[^>]*>/i, "")
    .replace(/<\/html>\s*$/, "");
  actions = {
    select: vi.fn(),
    pick: vi.fn(),
    activate: vi.fn(),
    key: vi.fn(),
    type: vi.fn(() => false),
    addFolder: vi.fn(),
    newFile: vi.fn(),
    refresh: vi.fn(),
    toggleHidden: vi.fn(),
    togglePreview: vi.fn(),
    context: vi.fn(),
  };
  const dnd = { draggable: (_el: unknown, options: Draggable) => void (draggable = options) };
  view = createView(document, actions, dnd as never);
  view.tree(rows, "~/notes/b.md", new Set(["~/notes/a.md", "~/notes/b.md"]));
});
const items = () => [...document.querySelectorAll<HTMLElement>("[role=treeitem]")];
const tree = () => document.getElementById("tree") as HTMLElement;
const press = (key: string, more: KeyboardEventInit = {}) =>
  tree().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...more }));

describe("a tree of several selected rows", () => {
  it("is multi-select, and every selected row says so", () => {
    expect(tree().getAttribute("aria-multiselectable")).toBe("true");
    expect(items().map((item) => item.getAttribute("aria-selected"))).toEqual([
      "true",
      "true",
      "false",
    ]);
    // The focused row alone takes Tab.
    expect(items().map((item) => item.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("a Shift- or Mod-click picks without opening; a plain click selects and opens", () => {
    const [a, , old] = items();
    old?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, shiftKey: true }));
    a?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, metaKey: true }));
    expect(actions.pick).toHaveBeenNthCalledWith(1, "~/notes/Old", { shift: true, mod: false });
    expect(actions.pick).toHaveBeenNthCalledWith(2, "~/notes/a.md", { shift: false, mod: true });
    expect(actions.activate).not.toHaveBeenCalled();
    a?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(actions.pick).toHaveBeenCalledTimes(2);
    expect(actions.select).toHaveBeenCalledExactlyOnceWith("~/notes/a.md");
    expect(actions.activate).toHaveBeenCalledExactlyOnceWith("~/notes/a.md");
  });

  it("Shift+arrows extend, and Mod+A, C, X, V and F run the explorer's commands", () => {
    press("ArrowDown", { shiftKey: true });
    expect(actions.key).toHaveBeenCalledWith("ArrowDown", { shift: true });
    for (const [key, command] of [
      ["a", "endue.explorer.select-all"],
      ["c", "endue.explorer.copy"],
      ["x", "endue.explorer.cut"],
      ["v", "endue.explorer.paste"],
      ["f", "endue.explorer.find"],
    ] as const) {
      press(key, { metaKey: true });
      expect(actions.context).toHaveBeenLastCalledWith(command);
    }
  });

  it("a drag from a selected row carries every selected path; from another row, that row", () => {
    const [a, , old] = items();
    expect(draggable?.item(a)?.items).toEqual([
      {
        type: "desk/paths",
        paths: [
          { path: "~/notes/a.md", kind: "file" },
          { path: "~/notes/b.md", kind: "file" },
        ],
      },
    ]);
    expect(draggable?.item(old)?.items).toEqual([
      { type: "desk/paths", paths: [{ path: "~/notes/Old", kind: "folder" }] },
    ]);
  });
});
