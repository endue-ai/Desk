// @vitest-environment jsdom
// The five tools say what they do by their icon: their titles never show as tooltips in the desk, and
// "New file" was a pencil, which reads as "rename" (#160, 20).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
document.documentElement.innerHTML = html
  .replace(/^<!doctype html>\s*<html[^>]*>/i, "")
  .replace(/<\/html>\s*$/, "");
const tools = [...document.querySelectorAll<HTMLButtonElement>("[role=toolbar] button")];

describe("the toolbar", () => {
  it("draws each tool as a line icon with a name, never a text glyph", () => {
    expect(tools.map((tool) => [tool.id, tool.getAttribute("aria-label")])).toEqual([
      ["add-folder", "Add a folder"],
      ["new-file", "New file"],
      ["toggle-preview", "Quick preview"],
      ["refresh", "Refresh"],
      ["toggle-hidden", "Dotfiles"],
    ]);
    for (const tool of tools) {
      expect(tool.textContent?.trim(), tool.id).toBe("");
      const icon = tool.querySelector("svg");
      expect(icon?.getAttribute("aria-hidden"), tool.id).toBe("true");
      expect(icon?.getAttribute("viewBox"), tool.id).toBe("0 0 24 24");
      expect(icon?.querySelectorAll("path").length, tool.id).toBeGreaterThan(0);
    }
  });

  it("shows New file as a page with a plus, and Add a folder as a folder with one", () => {
    expect(document.querySelector("#new-file svg")?.getAttribute("data-icon")).toBe("file-plus");
    expect(document.querySelector("#add-folder svg")?.getAttribute("data-icon")).toBe(
      "folder-plus",
    );
  });
});
