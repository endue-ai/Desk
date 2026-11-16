// Diffs: parsed into numbered lines, paired side by side, changed words found, and hunk or line
// patches that git apply takes — staged, unstaged and discarded against the real git.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { wordDiff } from "../ui/diff-text.js";
import { createOps } from "../ui/ops.js";
import { hunkPatch, pairLines, parseDiff } from "../ui/parse-diff.js";
import { loadDiff } from "../ui/repo.js";
import { realGit, tempRepo } from "./real-git";

const SAMPLE = [
  "diff --git a/x.js b/x.js",
  "index 1..2 100644",
  "--- a/x.js",
  "+++ b/x.js",
  "@@ -1,3 +1,3 @@ function f() {",
  " a",
  "-b",
  "+B",
  " c",
  "",
].join("\n");

describe("parseDiff", () => {
  it("numbers old and new lines and counts the change", () => {
    const [file] = parseDiff(SAMPLE);
    expect(file).toMatchObject({ path: "x.js", status: "modified", added: 1, removed: 1 });
    expect(file?.hunks[0]?.section).toBe("function f() {");
    expect(file?.hunks[0]?.lines.map((l) => [l.kind, l.old, l.new])).toEqual([
      [" ", 1, 1],
      ["-", 2, null],
      ["+", null, 2],
      [" ", 3, 3],
    ]);
  });

  it("pairs a removal with the addition after it", () => {
    const hunk = parseDiff(SAMPLE)[0]?.hunks[0];
    if (!hunk) throw new Error("no hunk");
    const rows = pairLines(hunk);
    expect(rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ["a", "a"],
      ["b", "B"],
      ["c", "c"],
    ]);
  });
});

describe("wordDiff", () => {
  it("marks only the words that changed", () => {
    const { before, after } = wordDiff("const COLUMNS = 3;", "const COLUMNS = 4;");
    expect(before).toEqual([{ start: 16, end: 17, cls: "word" }]);
    expect(after).toEqual([{ start: 16, end: 17, cls: "word" }]);
  });
  it("marks nothing when the whole line changed", () => {
    expect(wordDiff("alpha beta", "gamma delta")).toEqual({ before: [], after: [] });
  });
});

describe("hunk and line patches with git apply", () => {
  let repo: Awaited<ReturnType<typeof tempRepo>>;
  beforeEach(async () => {
    repo = await tempRepo();
    repo.write("a.txt", "1\n2\n3\n4\n5\n");
    await repo.git("commit", "-q", "-am", "Five lines");
  });
  afterEach(() => repo.done());

  const index = async () => (await repo.git("show", ":a.txt")).stdout;
  const unstagedHunk = async () => {
    const [file] = parseDiff(
      await loadDiff(realGit, repo.root, { kind: "unstaged", path: "a.txt" }),
    );
    if (!file?.hunks[0]) throw new Error("no diff");
    return { file, hunk: file.hunks[0] };
  };

  it("stages only the chosen lines, then unstages one of them", async () => {
    repo.write("a.txt", "1\nTWO\n3\nFOUR\n5\n");
    const ops = createOps(realGit, repo.root);
    const { file, hunk } = await unstagedHunk();
    // Lines: " 1", "-2", "+TWO", " 3", "-4", "+FOUR", " 5": take the first change only.
    const chosen = new Set(
      hunk.lines.flatMap((l, i) => (l.text === "2" || l.text === "TWO" ? [i] : [])),
    );
    const patch = hunkPatch(file, hunk, chosen);
    if (!patch) throw new Error("empty patch");
    await ops.applyPatch(patch, { cached: true });
    expect(await index()).toBe("1\nTWO\n3\n4\n5\n");

    const [staged] = parseDiff(
      await loadDiff(realGit, repo.root, { kind: "staged", path: "a.txt" }),
    );
    const stagedHunk = staged?.hunks[0];
    if (!staged || !stagedHunk) throw new Error("nothing staged");
    const added = new Set(stagedHunk.lines.flatMap((l, i) => (l.kind === "+" ? [i] : [])));
    const back = hunkPatch(staged, stagedHunk, added, { reverse: true });
    if (!back) throw new Error("empty patch");
    await ops.applyPatch(back, { cached: true, reverse: true });
    // Only the addition went back: the removal of "2" stays staged.
    expect(await index()).toBe("1\n3\n4\n5\n");
  });

  it("discards a whole hunk from the working copy", async () => {
    repo.write("a.txt", "1\n2\nthree\n4\n5\n");
    const { file, hunk } = await unstagedHunk();
    const patch = hunkPatch(file, hunk);
    if (!patch) throw new Error("empty patch");
    await createOps(realGit, repo.root).applyPatch(patch, { reverse: true });
    expect(readFileSync(join(repo.root, "a.txt"), "utf8")).toBe("1\n2\n3\n4\n5\n");
  });

  it("returns no patch when no change is chosen", async () => {
    repo.write("a.txt", "1\n2\nthree\n4\n5\n");
    const { file, hunk } = await unstagedHunk();
    expect(hunkPatch(file, hunk, new Set([0]))).toBeNull();
  });
});
