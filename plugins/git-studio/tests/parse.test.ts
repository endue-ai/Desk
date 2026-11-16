// What git prints, read right: refs with tracking, the log's records, stashes, worktrees, changed
// files (renames included) and porcelain v2 status.
import { describe, expect, it } from "vitest";
import {
  parseChangedFiles,
  parseLog,
  parseRefs,
  parseStashes,
  parseTrack,
  parseWorktrees,
  splitMessage,
} from "../ui/parse.js";
import { changeCount, parseStatus } from "../ui/parse-status.js";
import { parseRemotes } from "../ui/repo.js";

const US = "\x1f";
const RS = "\x1e";

describe("parseRefs", () => {
  it("reads heads, remotes and tags, peels annotated tags and skips origin/HEAD", () => {
    const line = (...f: string[]) => f.join(US);
    const out = [
      line("refs/heads/main", "a1", "", "origin/main", "ahead 1, behind 2", "*", "100", "Tip"),
      line("refs/heads/old", "b2", "", "origin/old", "gone", " ", "90", "Old"),
      line("refs/remotes/origin/HEAD", "a1", "", "", "", " ", "100", ""),
      line("refs/remotes/origin/main", "c3", "", "", "", " ", "100", "Remote"),
      line("refs/tags/v1", "t0", "d4", "", "", " ", "80", "Release"),
    ].join("\n");
    const refs = parseRefs(out);
    expect(refs.map((r) => [r.kind, r.name, r.sha])).toEqual([
      ["head", "main", "a1"],
      ["head", "old", "b2"],
      ["remote", "origin/main", "c3"],
      ["tag", "v1", "d4"],
    ]);
    expect(refs[0]).toMatchObject({ current: true, ahead: 1, behind: 2, upstream: "origin/main" });
    expect(refs[1]?.gone).toBe(true);
    expect(refs[2]?.remote).toBe("origin");
  });

  it("reads tracking words", () => {
    expect(parseTrack("behind 3")).toEqual({ ahead: 0, behind: 3, gone: false });
    expect(parseTrack("")).toEqual({ ahead: 0, behind: 0, gone: false });
  });
});

describe("parseLog", () => {
  it("splits records and keeps a subject that holds the field separator", () => {
    const record = (sha: string, parents: string, subject: string) =>
      [sha, parents, "Ada", "ada@example.com", "10", "Ada", "11", subject].join(US) + RS;
    const out = `${record("aaaaaaa1", "bbbbbbb2 ccccccc3", "Merge")}\n${record("bbbbbbb2", "", `odd${US}subject`)}\n`;
    const commits = parseLog(out);
    expect(commits).toHaveLength(2);
    expect(commits[0]?.parents).toEqual(["bbbbbbb2", "ccccccc3"]);
    expect(commits[1]?.parents).toEqual([]);
    expect(commits[1]?.subject).toBe(`odd${US}subject`);
    expect(commits[0]?.date).toBe(10);
  });
});

describe("parseStashes and parseWorktrees", () => {
  it("reads stash entries without git's WIP prefix", () => {
    const out = ["stash@{0}", "s1", "p1 p2", "50", "On main: Half-done"].join(US);
    expect(parseStashes(out)).toEqual([
      {
        index: 0,
        name: "stash@{0}",
        sha: "s1",
        parents: ["p1", "p2"],
        date: 50,
        message: "Half-done",
      },
    ]);
  });

  it("reads worktree blocks", () => {
    const out =
      "worktree /a\nHEAD 111\nbranch refs/heads/main\n\nworktree /b\nHEAD 222\ndetached\nlocked\n";
    const trees = parseWorktrees(out);
    expect(trees.map((t) => [t.path, t.branch, t.detached, t.locked])).toEqual([
      ["/a", "main", false, false],
      ["/b", null, true, true],
    ]);
  });
});

describe("parseChangedFiles", () => {
  it("merges name-status with numstat, renames and binaries included", () => {
    const names = ["M", "src/a.js", "R087", "old.js", "new.js", "A", "img.png", ""].join("\0");
    const numbers = ["3\t1\tsrc/a.js", "2\t2\t", "old.js", "new.js", "-\t-\timg.png", ""].join(
      "\0",
    );
    expect(parseChangedFiles(names, numbers)).toEqual([
      { path: "src/a.js", change: "M", added: 3, removed: 1 },
      { path: "new.js", origPath: "old.js", change: "R", added: 2, removed: 2 },
      { path: "img.png", change: "A", added: null, removed: null },
    ]);
  });
});

describe("parseStatus", () => {
  it("reads the header, both sides of a change, renames, untracked and conflicts", () => {
    const out = [
      "# branch.oid abc",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "# stash 3",
      "1 MM N... 100644 100644 100644 h1 h2 src/a b.js",
      "2 R. N... 100644 100644 100644 h1 h2 R100 new.js",
      "old.js",
      "u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.js",
      "? notes.md",
      "",
    ].join("\0");
    const status = parseStatus(out);
    expect(status).toMatchObject({
      oid: "abc",
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      stashCount: 3,
    });
    expect(status.staged).toEqual([
      { path: "src/a b.js", change: "M" },
      { path: "new.js", change: "R", origPath: "old.js" },
    ]);
    expect(status.unstaged).toEqual([
      { path: "src/a b.js", change: "M" },
      { path: "notes.md", change: "?" },
    ]);
    expect(status.conflicts).toEqual([{ path: "conflict.js", code: "UU", label: "both modified" }]);
    expect(changeCount(status)).toBe(4);
  });

  it("knows a detached HEAD and a repository before its first commit", () => {
    expect(parseStatus("# branch.oid (initial)\0# branch.head (detached)\0")).toMatchObject({
      oid: null,
      branch: null,
      detached: true,
    });
  });
});

describe("small readers", () => {
  it("splits a message into summary and body", () => {
    expect(splitMessage("Title\n\nBody line\n")).toEqual({ summary: "Title", body: "Body line" });
    expect(splitMessage("Only\n")).toEqual({ summary: "Only", body: "" });
  });

  it("lists each remote once", () => {
    const out =
      "origin\tgit@x:a.git (fetch)\norigin\tgit@x:a.git (push)\nup\thttps://y/b (fetch)\n";
    expect(parseRemotes(out)).toEqual([
      { name: "origin", url: "git@x:a.git" },
      { name: "up", url: "https://y/b" },
    ]);
  });
});
