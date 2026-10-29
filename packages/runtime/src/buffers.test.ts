import { describe, expect, it } from "vitest";
import { Buffers, baseName } from "./buffers";
import { opener } from "./policies/files";

const buffer = (id: string, plugin: string, extra: { path?: string; modified?: boolean } = {}) => ({
  id,
  name: id,
  plugin,
  modified: false,
  surface: false,
  ...extra,
});

describe("Buffers", () => {
  it("keeps the order buffers were used in, most recent first", () => {
    const list = new Buffers();
    list.add(buffer("a", "p"));
    list.add(buffer("b", "p"));
    list.touch("b");
    list.touch("a");
    expect(list.list().map((b) => b.id)).toEqual(["a", "b"]);
    expect(list.current()?.id).toBe("a");
    list.remove("a");
    expect(list.current()?.id).toBe("b");
  });

  it("finds buffers by path and plugin, and updates them", () => {
    const list = new Buffers();
    list.add(buffer("file:~/a.md", "example.notes", { path: "~/a.md" }));
    list.add(buffer("surface:example.chat", "example.chat"));
    expect(list.byPath("~/a.md")?.id).toBe("file:~/a.md");
    expect(list.ofPlugin("example.chat").map((b) => b.id)).toEqual(["surface:example.chat"]);
    expect(list.update("file:~/a.md", { modified: true })?.modified).toBe(true);
    expect(list.update("missing", { modified: true })).toBeUndefined();
  });

  it("steps through buffers in a stable order, wrapping around", () => {
    const list = new Buffers();
    for (const [id, plugin] of [
      ["b", "p2"],
      ["a", "p1"],
      ["c", "p2"],
    ] as const)
      list.add(buffer(id, plugin));
    expect(list.step("a", 1)?.id).toBe("b");
    expect(list.step("c", 1)?.id).toBe("a");
    expect(list.step("a", -1)?.id).toBe("c");
    expect(list.step(undefined, 1)?.id).toBe("a");
    expect(new Buffers().step(undefined, 1)).toBeUndefined();
  });

  it("tells listeners about every change", () => {
    const list = new Buffers();
    let changes = 0;
    list.onChange(() => changes++);
    list.add(buffer("a", "p"));
    list.update("a", { name: "A" });
    list.remove("a");
    expect(changes).toBe(3);
  });
});

describe("opener and baseName", () => {
  const rules = [
    { pattern: "**/Makefile", plugin: "example.make", owner: "example.make" },
    { pattern: "*.md", plugin: "example.notes", owner: "example.notes" },
    { pattern: "*", plugin: "example.text", owner: "example.text" },
  ];

  it("asks the rules in order: patterns with a slash see the path, others the name", () => {
    expect(opener(rules, "~/src/Makefile")).toBe("example.make");
    expect(opener(rules, "~/notes/a.md")).toBe("example.notes");
    expect(opener(rules, "~/notes/a.txt")).toBe("example.text");
    expect(opener([], "~/notes/a.md")).toBeUndefined();
  });

  it("names a path by its last part", () => {
    expect(baseName("~/notes/a.md")).toBe("a.md");
    expect(baseName("/tmp/dir/")).toBe("dir");
    expect(baseName("~")).toBe("~");
  });
});
