// The patch of chosen lines: what is left out still matches the side git applies it to, the counts
// are recomputed, and git itself accepts every patch built here (`git apply --check` in a temporary
// repository).
import { afterEach, describe, expect, it } from "vitest";
import { parseDiff } from "../ui/parse-diff.js";
import { allLines, linesPatch } from "../ui/patch.js";
import { type TempRepo, tempRepo } from "./real-git";

const DIFF = `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,4 +1,4 @@
 one
-two
-three
+TWO
+THREE
 four
`;

const parsed = () => {
  const file = parseDiff(DIFF)[0];
  const hunk = file?.hunks[0];
  if (!file || !hunk) throw new Error("no hunk");
  return { file, hunk };
};

let repo: TempRepo | undefined;
afterEach(() => repo?.remove());

describe("linesPatch", () => {
  it("is the whole hunk when every line is chosen", () => {
    const { file, hunk } = parsed();
    expect(linesPatch(file, hunk, allLines(hunk), false)).toBe(DIFF.replace(/^index .*\n/m, ""));
  });

  it("forward: an unchosen + is dropped, an unchosen - is context", () => {
    const { file, hunk } = parsed();
    // -two and +TWO only.
    expect(linesPatch(file, hunk, new Set([1, 3]), false)).toBe(
      [
        "diff --git a/a.txt b/a.txt",
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -1,4 +1,4 @@",
        " one",
        "-two",
        " three",
        "+TWO",
        " four",
        "",
      ].join("\n"),
    );
  });

  it("reverse: an unchosen - is dropped, an unchosen + is context", () => {
    const { file, hunk } = parsed();
    expect(linesPatch(file, hunk, new Set([1, 3]), true)).toBe(
      [
        "diff --git a/a.txt b/a.txt",
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -1,4 +1,4 @@",
        " one",
        "-two",
        "+TWO",
        " THREE",
        " four",
        "",
      ].join("\n"),
    );
  });

  it("counts what is left and is null when nothing changes", () => {
    const { file, hunk } = parsed();
    expect(linesPatch(file, hunk, new Set([3, 4]), false)).toContain("@@ -1,4 +1,6 @@");
    expect(linesPatch(file, hunk, new Set([1, 2]), true)).toContain("@@ -1,6 +1,4 @@");
    expect(linesPatch(file, hunk, new Set([0, 5]), false)).toBeNull();
  });

  it("keeps a no-newline note only with the line it follows", () => {
    const [file] = parseDiff(
      "diff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
    );
    const hunk = file?.hunks[0];
    if (!file || !hunk) throw new Error("no hunk");
    const patch = linesPatch(file, hunk, new Set([2]), false) ?? "";
    expect(patch.split("\n").slice(4)).toEqual([
      " old",
      "\\ No newline at end of file",
      "+new",
      "\\ No newline at end of file",
      "",
    ]);
  });

  it("builds patches git applies to the index, forward and in reverse", () => {
    repo = tempRepo({ "a.txt": "one\ntwo\nthree\nfour\n" });
    repo.write("a.txt", "one\nTWO\nTHREE\nfour\n");
    const { file, hunk } = parsed();
    for (const chosen of [[1], [3], [1, 3], [2, 4], [1, 2, 3, 4]]) {
      const patch = linesPatch(file, hunk, new Set(chosen), false) ?? "";
      expect(
        () => applyWith(repo as TempRepo, patch, ["--cached", "--check"]),
        String(chosen),
      ).not.toThrow();
    }
    repo.git("add", "a.txt");
    for (const chosen of [[1], [4], [1, 3], [2, 4]]) {
      const patch = linesPatch(file, hunk, new Set(chosen), true) ?? "";
      expect(() =>
        applyWith(repo as TempRepo, patch, ["--cached", "--reverse", "--check"]),
      ).not.toThrow();
    }
  });
});

/** `git apply` with the patch in a file of the repository's git folder. */
function applyWith(at: TempRepo, patch: string, flags: string[]) {
  at.write(".git/test.patch", patch);
  at.git("apply", "--recount", ...flags, ".git/test.patch");
}
