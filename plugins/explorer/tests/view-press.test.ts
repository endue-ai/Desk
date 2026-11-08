// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Row } from "../ui/tree.js";
import { createView } from "../ui/view.js";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const file: Row = {
  id: "~/notes/a.md",
  path: "~/notes/a.md",
  name: "a.md",
  kind: "file",
  depth: 1,
  root: "~/notes",
  hidden: false,
  size: 827,
};
let actions: Parameters<typeof createView>[1];
beforeEach(() => {
  document.documentElement.innerHTML = html
    .replace(/^<!doctype html>\s*<html[^>]*>/i, "")
    .replace(/<\/html>\s*$/, "");
  actions = {
    select: vi.fn(),
    activate: vi.fn(),
    key: vi.fn(),
    type: vi.fn(() => false),
    addFolder: vi.fn(),
    newFile: vi.fn(),
    refresh: vi.fn(),
    toggleHidden: vi.fn(),
    togglePreview: vi.fn(),
  };
  createView(document, actions).tree([file], null);
});
const item = () => document.querySelector<HTMLElement>("[role=treeitem]") as HTMLElement;

describe("pressing a row", () => {
  it("never starts a drag: the row is not draggable and a drag from its name is cancelled", () => {
    expect(item().getAttribute("draggable")).toBeNull();
    const drag = new Event("dragstart", { bubbles: true, cancelable: true });
    item().querySelector(".name")?.dispatchEvent(drag);
    expect(drag.defaultPrevented).toBe(true);
  });

  it("a click selects and opens the file once", () => {
    item().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    item().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
    expect(actions.select).toHaveBeenCalledExactlyOnceWith(file.id);
    expect(actions.activate).toHaveBeenCalledExactlyOnceWith(file.id);
  });
});
