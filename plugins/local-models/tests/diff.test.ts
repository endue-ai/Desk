// Line diffs for a model's proposed edits (M7, not drawn by the page yet): the edit script, hunks
// with context, the counts and the unified form.
import { describe, expect, it } from "vitest";
import { counts, diffLines, hunks, unified } from "../ui/diff.js";

describe("diff", () => {
  it("finds the lines kept, added and removed, in order", () => {
    const lines = diffLines("a\nb\nc\n", "a\nB\nc\nd\n");
    expect(lines.map((l) => `${l.type} ${l.text}`)).toEqual([
      "same a",
      "del b",
      "add B",
      "same c",
      "add d",
    ]);
    expect(counts(lines)).toEqual({ added: 2, removed: 1 });
  });

  it("answers no change for equal texts and whole adds for an empty one", () => {
    expect(counts(diffLines("x\ny", "x\ny\n"))).toEqual({ added: 0, removed: 0 });
    expect(diffLines("", "x\ny").map((l) => l.type)).toEqual(["add", "add"]);
  });

  it("cuts far-apart changes into hunks with context and writes them unified", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    const after = before.replace("line 2\n", "line two\n").replace("line 18\n", "line eighteen\n");
    const hs = hunks(diffLines(before, after), 1);
    expect(hs).toHaveLength(2);
    expect(hs[0]?.lines.map((l) => l.text)).toEqual(["line 1", "line 2", "line two", "line 3"]);
    const text = unified("notes.txt", hs);
    expect(text.split("\n").slice(0, 3)).toEqual([
      "--- a/notes.txt",
      "+++ b/notes.txt",
      "@@ -1,3 +1,3 @@",
    ]);
    expect(text).toContain("-line 18\n+line eighteen");
  });
});
