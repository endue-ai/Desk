import { describe, expect, it } from "vitest";
import { resolveBindings } from "./conflicts";
import { filterItems, itemsOf, moveSelection, overlayAction } from "./which-key-model";

const { bindings } = resolveBindings(
  [
    { key: "Ctrl+C p f", command: "example.project.file", owner: "example.project" },
    { key: "Ctrl+C p s", command: "example.project.search", owner: "example.project" },
    { key: "Ctrl+C Ctrl+T", command: "desk.theme.toggle", owner: "person" },
    { key: "Ctrl+X Ctrl+F", command: "desk.files.open", owner: "desk" },
  ],
  "other",
);
const facts = {
  platform: "other" as const,
  title: (id: string) =>
    ({ "example.project.file": "Find a file in the project", "desk.theme.toggle": "Toggle theme" })[
      id
    ],
  available: (id: string) => id !== "example.project.search",
  owner: (owner: string) => (owner === "person" ? "you" : owner),
};

describe("the which-key overlay's model", () => {
  it("lists every continuation of a prefix with the keys left, the title and the owner", () => {
    const items = itemsOf(bindings, ["Control+C"], facts);
    expect(items.map((i) => [i.keys.join(" "), i.title, i.owner, i.off])).toEqual([
      ["Ctrl+T", "Toggle theme", "you", false],
      ["P F", "Find a file in the project", "example.project", false],
      ["P S", "example.project.search", "example.project", true],
    ]);
    expect(itemsOf(bindings, ["Control+C", "P"], facts).map((i) => i.rest)).toEqual([["F"], ["S"]]);
    expect(itemsOf(bindings, ["Control+Q"], facts)).toEqual([]);
  });

  it("searches keys, titles, command ids and owners, every word", () => {
    const items = itemsOf(bindings, ["Control+C"], facts);
    expect(filterItems(items, "find project").map((i) => i.command)).toEqual([
      "example.project.file",
    ]);
    expect(filterItems(items, "you").map((i) => i.command)).toEqual(["desk.theme.toggle"]);
    expect(filterItems(items, "  ")).toHaveLength(3);
  });

  it("tries a key as the next chord first, then navigates, searches or ends the wait", () => {
    const plain = { searching: false, continues: false, printable: false };
    expect(overlayAction("Escape", { ...plain, continues: true })).toBe("cancel");
    expect(overlayAction("Control+G", plain)).toBe("cancel");
    expect(overlayAction("P", { ...plain, continues: true, printable: true })).toBe("continue");
    expect(overlayAction("ArrowDown", { ...plain, continues: true })).toBe("continue");
    expect(overlayAction("ArrowDown", plain)).toBe("down");
    expect(overlayAction("ArrowUp", plain)).toBe("up");
    expect(overlayAction("Enter", plain)).toBe("run");
    expect(overlayAction("Backspace", plain)).toBe("back");
    expect(overlayAction("Tab", plain)).toBe("stay");
    expect(overlayAction("Z", { ...plain, printable: true })).toBe("type");
    expect(overlayAction("Control+Q", plain)).toBe("unbound");
    // Searching: keys edit the search; only chords with a modifier still continue.
    const searching = { ...plain, searching: true };
    expect(overlayAction("P", { ...searching, continues: true, printable: true })).toBe("type");
    expect(overlayAction("Backspace", searching)).toBe("type");
    expect(overlayAction("Control+T", { ...searching, continues: true })).toBe("continue");
    expect(overlayAction("Enter", searching)).toBe("run");
  });

  it("moves the selection around the list", () => {
    expect(moveSelection(0, 3, 1)).toBe(1);
    expect(moveSelection(2, 3, 1)).toBe(0);
    expect(moveSelection(0, 3, -1)).toBe(2);
    expect(moveSelection(-1, 3, 1)).toBe(0);
    expect(moveSelection(0, 0, 1)).toBe(-1);
  });
});
