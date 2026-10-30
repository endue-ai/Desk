import { describe, expect, it } from "vitest";
import { hunkPatch, parseDiff, stats } from "../ui/parse-diff.js";

const TWO_FILES = `diff --git a/src/a.js b/src/a.js
index 1111111..2222222 100644
--- a/src/a.js
+++ b/src/a.js
@@ -1,3 +1,4 @@ function a() {
 one
-two
+two!
+three
 four
@@ -10,2 +11,2 @@
 ten
-eleven
+eleven!
diff --git a/README.md b/README.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/README.md
@@ -0,0 +1 @@
+# Hello
\\ No newline at end of file
`;

describe("parseDiff", () => {
  it("files, hunks and lines with their numbers", () => {
    const files = parseDiff(TWO_FILES);
    expect(files.map((f) => [f.path, f.status, f.hunks.length])).toEqual([
      ["src/a.js", "modified", 2],
      ["README.md", "added", 1],
    ]);
    const [first] = files[0]?.hunks ?? [];
    expect(first).toMatchObject({
      header: "@@ -1,3 +1,4 @@ function a() {",
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 4,
      heading: "function a() {",
    });
    expect(first?.lines).toEqual([
      { kind: "context", text: "one", oldNo: 1, newNo: 1 },
      { kind: "del", text: "two", oldNo: 2, newNo: null },
      { kind: "add", text: "two!", oldNo: null, newNo: 2 },
      { kind: "add", text: "three", oldNo: null, newNo: 3 },
      { kind: "context", text: "four", oldNo: 3, newNo: 4 },
    ]);
    expect(files[0]?.hunks[1]).toMatchObject({ oldStart: 10, oldCount: 2, heading: "" });
    expect(files[1]?.oldPath).toBeNull();
    expect(files[1]?.hunks[0]?.lines.at(-1)).toEqual({
      kind: "note",
      text: "No newline at end of file",
      oldNo: null,
      newNo: null,
    });
    expect(stats(files)).toEqual({ files: 2, additions: 4, deletions: 2 });
  });

  it("renames, deletions, binaries and names with spaces", () => {
    const files = parseDiff(
      [
        "diff --git a/old name.js b/new name.js",
        "similarity index 90%",
        "rename from old name.js",
        "rename to new name.js",
        "diff --git a/gone.txt b/gone.txt",
        "deleted file mode 100644",
        "index 1111111..0000000",
        "--- a/gone.txt",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-bye",
        "diff --git a/logo.png b/logo.png",
        "index 1111111..2222222 100644",
        "Binary files a/logo.png and b/logo.png differ",
        "",
      ].join("\n"),
    );
    expect(files[0]).toMatchObject({
      path: "new name.js",
      oldPath: "old name.js",
      status: "renamed",
    });
    expect(files[1]).toMatchObject({ path: "gone.txt", status: "deleted" });
    expect(files[1]?.hunks[0]?.lines).toEqual([
      { kind: "del", text: "bye", oldNo: 1, newNo: null },
    ]);
    expect(files[2]).toMatchObject({ path: "logo.png", binary: true, hunks: [] });
    expect(parseDiff("")).toEqual([]);
  });

  it("hunkPatch writes one hunk back as a patch git apply takes", () => {
    const [file] = parseDiff(TWO_FILES);
    const hunk = file?.hunks[1];
    if (!file || !hunk) throw new Error("fixture");
    expect(hunkPatch(file, hunk)).toBe(
      [
        "diff --git a/src/a.js b/src/a.js",
        "--- a/src/a.js",
        "+++ b/src/a.js",
        "@@ -10,2 +11,2 @@",
        " ten",
        "-eleven",
        "+eleven!",
        "",
      ].join("\n"),
    );
    const [, added] = parseDiff(TWO_FILES);
    const only = added?.hunks[0];
    if (!added || !only) throw new Error("fixture");
    expect(hunkPatch(added, only)).toContain("--- /dev/null\n+++ b/README.md\n");
    expect(hunkPatch(added, only)).toContain("\n\\ No newline at end of file\n");
  });
});
