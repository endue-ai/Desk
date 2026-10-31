import { describe, expect, it } from "vitest";
import {
  conflictLabel,
  parseRecent,
  parseStashes,
  parseStatus,
  summary,
} from "../ui/parse-status.js";
import { CLEAN_STATUS, z } from "./harness";

const HEAD = [
  "# branch.oid 1111111111111111111111111111111111111111",
  "# branch.head main",
  "# branch.upstream origin/main",
  "# branch.ab +2 -1",
];
const H = "1111111 2222222";

describe("parseStatus", () => {
  it("reads the head, its upstream and how far ahead and behind", () => {
    const { head } = parseStatus(z(...HEAD));
    expect(head).toEqual({
      oid: "1111111111111111111111111111111111111111",
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    });
    expect(summary(parseStatus(CLEAN_STATUS))).toBe("nothing to commit, working tree clean");
  });

  it("a detached head and a repository without commits", () => {
    const detached = parseStatus(z("# branch.oid abc", "# branch.head (detached)"));
    expect(detached.head).toMatchObject({ oid: "abc", branch: null, upstream: null });
    const fresh = parseStatus(z("# branch.oid (initial)", "# branch.head main"));
    expect(fresh.head).toMatchObject({ oid: null, branch: "main" });
  });

  it("places ordinary entries by their index and worktree letters", () => {
    const model = parseStatus(
      z(
        ...HEAD,
        `1 M. N... 100644 100644 100644 ${H} staged.js`,
        `1 .M N... 100644 100644 100644 ${H} unstaged.js`,
        `1 MM N... 100644 100644 100644 ${H} both.js`,
        `1 A. N... 000000 100644 100644 ${H} new file.txt`,
        `1 .D N... 100644 100644 000000 ${H} gone.js`,
        `1 .M S.M. 160000 160000 160000 ${H} vendor/sub`,
        "? notes/draft.md",
        "! build/",
      ),
    );
    expect(model.staged.map((e) => [e.path, e.change])).toEqual([
      ["staged.js", "modified"],
      ["both.js", "modified"],
      ["new file.txt", "added"],
    ]);
    expect(model.unstaged.map((e) => [e.path, e.change, e.submodule])).toEqual([
      ["unstaged.js", "modified", false],
      ["both.js", "modified", false],
      ["gone.js", "deleted", false],
      ["vendor/sub", "modified", true],
    ]);
    expect(model.untracked).toEqual(["notes/draft.md"]);
    expect(summary(model)).toBe("3 staged · 4 unstaged · 1 untracked");
  });

  it("a rename carries both paths, from two NUL-separated fields", () => {
    const model = parseStatus(
      z(...HEAD, `2 R. N... 100644 100644 100644 ${H} R100 new/name.js`, "old/name.js"),
    );
    expect(model.staged).toEqual([
      {
        path: "new/name.js",
        origPath: "old/name.js",
        change: "renamed",
        code: "R.",
        submodule: false,
      },
    ]);
    expect(model.unstaged).toEqual([]);
  });

  it("unmerged entries become conflicts with words for their code", () => {
    const model = parseStatus(
      z(...HEAD, `u UU N... 100644 100644 100644 100644 ${H} 4444444 src/clash.js`),
    );
    expect(model.conflicts).toEqual([
      { path: "src/clash.js", change: "unmerged", code: "UU", submodule: false },
    ]);
    expect(conflictLabel("UU")).toBe("both modified");
    expect(conflictLabel("DU")).toBe("deleted by us");
    expect(conflictLabel("AA")).toBe("both added");
    expect(summary(model)).toBe("1 unmerged");
  });

  it("paths with newlines survive the NUL records", () => {
    const model = parseStatus(z(...HEAD, `1 .M N... 100644 100644 100644 ${H} odd\nname.txt`));
    expect(model.unstaged[0]?.path).toBe("odd\nname.txt");
  });
});

describe("stashes and recent commits", () => {
  it("parseStashes reads the ref and the subject", () => {
    expect(parseStashes("stash@{0}\x1fWIP on main: 1111111 Initial\nstash@{1}\x1fsaved\n")).toEqual(
      [
        { ref: "stash@{0}", subject: "WIP on main: 1111111 Initial" },
        { ref: "stash@{1}", subject: "saved" },
      ],
    );
    expect(parseStashes("")).toEqual([]);
  });

  it("parseRecent reads the short sha, subject and decorations", () => {
    expect(
      parseRecent("abc1234\x1ffeat: thing\x1fHEAD -> main, origin/main\ndef5678\x1ffix\x1f\n"),
    ).toEqual([
      { sha: "abc1234", subject: "feat: thing", refs: ["HEAD -> main", "origin/main"] },
      { sha: "def5678", subject: "fix", refs: [] },
    ]);
  });
});
