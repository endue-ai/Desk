// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Row } from "../ui/tree.js";
import { createView } from "../ui/view.js";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const row: Row = {
  id: "/a.html",
  path: "/a.html",
  name: "a.html",
  kind: "file",
  depth: 1,
  root: "/",
  hidden: false,
  size: 20,
};
let actions: Parameters<typeof createView>[1];
let view: ReturnType<typeof createView>;
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
  };
  view = createView(document, actions);
  view.tree([row], row.id);
  view.focus(row.id);
});
const item = () => document.querySelector<HTMLElement>("[role=treeitem]") as HTMLElement;
const show = (model: unknown) =>
  (view as unknown as { preview(value: unknown): void }).preview(model);

describe("Explorer quick preview controls", () => {
  it("one click only selects a file and double click opens it", () => {
    const original = item();
    item().click();
    view.selection(row.id);
    expect(item()).toBe(original);
    expect(actions.select).toHaveBeenCalledWith(row.id);
    expect(actions.activate).not.toHaveBeenCalled();
    item().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(actions.activate).toHaveBeenCalledExactlyOnceWith(row.id);
  });

  it("shows safe text, a labeled region, open/close controls and keeps tree focus", () => {
    const text = '<img src=x onerror="alert(1)"><script>bad()</script>';
    show({ ...row, kind: "text", text, truncated: true });
    const preview = document.querySelector<HTMLElement>("#preview");
    expect(preview?.hidden).toBe(false);
    expect(preview?.getAttribute("aria-labelledby")).toBe("preview-title");
    expect(preview?.textContent).toContain(text);
    expect(preview?.querySelector("img,script")).toBeNull();
    expect(preview?.textContent).toMatch(/first 64 KiB/i);
    expect(document.activeElement).toBe(item());
    document.querySelector<HTMLButtonElement>("#preview-open")?.click();
    expect(actions.activate).toHaveBeenCalledWith(row.id);
    document.querySelector<HTMLButtonElement>("#preview-close")?.click();
    expect(actions.key).toHaveBeenCalledWith("Escape");
  });

  it("loading and failure are visible, and Escape passes through when preview is closed", () => {
    show({ ...row, kind: "loading" });
    expect(document.querySelector("#preview")?.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector("#preview")?.textContent).toContain("Loading");
    show({ ...row, kind: "error", reason: "Not allowed to read this file." });
    expect(document.querySelector("#preview")?.textContent).toContain(
      "Not allowed to read this file.",
    );
    const escapeKey = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    item().dispatchEvent(escapeKey);
    expect(escapeKey.defaultPrevented).toBe(true);
    expect(actions.key).toHaveBeenCalledWith("Escape");
    show(null);
    const next = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    item().dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
  });
});
