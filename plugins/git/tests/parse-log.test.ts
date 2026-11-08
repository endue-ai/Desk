import { describe, expect, it } from "vitest";
import {
  LOG_FORMAT,
  laneCount,
  layoutGraph,
  parseLog,
  parseRefs,
  relativeTime,
} from "../ui/parse-log.js";

const record = (sha: string, parents: string, refs = "", subject = `commit ${sha}`) =>
  `${sha}\x1f${parents}\x1fAda\x1f2026-10-30T09:00:00+09:00\x1f${refs}\x1f${subject}\x1e\n`;

describe("parseLog", () => {
  it("splits records and fields, parents by spaces, refs by kind", () => {
    const text =
      record("c", "b", "HEAD -> main, origin/main, tag: v1") + record("b", "a") + record("a", "");
    const commits = parseLog(text, ["origin"]);
    expect(commits.map((c) => [c.sha, c.parents])).toEqual([
      ["c", ["b"]],
      ["b", ["a"]],
      ["a", []],
    ]);
    expect(commits[0]).toMatchObject({ author: "Ada", subject: "commit c" });
    expect(commits[0]?.refs).toEqual([
      { name: "main", kind: "branch", current: true },
      { name: "origin/main", kind: "remote", current: false },
      { name: "v1", kind: "tag", current: false },
    ]);
    expect(LOG_FORMAT).toBe("%H%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x1e");
  });

  it("a detached HEAD and a branch with a slash that is not a remote", () => {
    expect(parseRefs("HEAD, feature/x", ["origin"])).toEqual([
      { name: "HEAD", kind: "head", current: true },
      { name: "feature/x", kind: "branch", current: false },
    ]);
    expect(parseRefs("")).toEqual([]);
    expect(parseLog("")).toEqual([]);
  });
});

describe("layoutGraph", () => {
  const commit = (sha: string, ...parents: string[]) => ({ sha, parents });

  it("a straight history stays on one lane", () => {
    const rows = layoutGraph([commit("c", "b"), commit("b", "a"), commit("a")]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows[0]).toEqual({
      sha: "c",
      lane: 0,
      before: [],
      after: ["b"],
      parentLanes: [0],
      joins: [],
    });
    expect(rows[2]).toEqual({
      sha: "a",
      lane: 0,
      before: ["a"],
      after: [],
      parentLanes: [],
      joins: [],
    });
    expect(laneCount(rows)).toBe(1);
  });

  it("a merge opens a second lane that bends back into the first at the fork point", () => {
    // m merges f into main: m -> (b, f), f -> a, b -> a, a.
    const rows = layoutGraph([
      commit("m", "b", "f"),
      commit("f", "a"),
      commit("b", "a"),
      commit("a"),
    ]);
    expect(rows.map((r) => [r.sha, r.lane])).toEqual([
      ["m", 0],
      ["f", 1],
      ["b", 0],
      ["a", 0],
    ]);
    expect(rows[0]?.after).toEqual(["b", "f"]);
    expect(rows[0]?.parentLanes).toEqual([0, 1]);
    // f's parent a is not waited for yet, so lane 1 waits for it.
    expect(rows[1]?.after).toEqual(["b", "a"]);
    // b's parent a is waited for on the right: lane 1 is pulled over and bends into lane 0.
    expect(rows[2]?.parentLanes).toEqual([0]);
    expect(rows[2]?.joins).toEqual([{ from: 1, to: 0 }]);
    expect(rows[2]?.after).toEqual(["a"]);
    expect(rows[3]).toMatchObject({ lane: 0, before: ["a"], after: [], joins: [] });
    expect(laneCount(rows)).toBe(2);
  });

  it("a branch whose parent is waited for on the left ends by bending into that lane", () => {
    // Two tips: main (y -> a) on lane 0 and topic (x -> a) on lane 1; x bends left into lane 0.
    const rows = layoutGraph([commit("y", "a"), commit("x", "a"), commit("a")]);
    expect(rows.map((r) => [r.sha, r.lane])).toEqual([
      ["y", 0],
      ["x", 1],
      ["a", 0],
    ]);
    expect(rows[1]).toMatchObject({ parentLanes: [0], after: ["a"], joins: [] });
  });

  it("an unrelated tip (a second root, or --all) takes the first free lane", () => {
    const rows = layoutGraph([commit("x", "w"), commit("y"), commit("w")]);
    expect(rows.map((r) => [r.sha, r.lane])).toEqual([
      ["x", 0],
      ["y", 1],
      ["w", 0],
    ]);
    expect(rows[1]?.before).toEqual(["w"]);
    expect(rows[1]?.after).toEqual(["w"]);
  });

  it("an octopus merge fans out to every parent", () => {
    const rows = layoutGraph([commit("o", "a", "b", "c"), commit("a"), commit("b"), commit("c")]);
    expect(rows[0]?.parentLanes).toEqual([0, 1, 2]);
    expect(rows[0]?.after).toEqual(["a", "b", "c"]);
    expect(rows.slice(1).map((r) => r.lane)).toEqual([0, 1, 2]);
    expect(rows[3]?.after).toEqual([]);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");
  it("says how long ago in the nearest unit", () => {
    expect(relativeTime("2026-10-31T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-10-31T11:45:00Z", now)).toBe("15 min ago");
    expect(relativeTime("2026-10-31T09:00:00Z", now)).toBe("3 h ago");
    expect(relativeTime("2026-10-29T12:00:00Z", now)).toBe("2 d ago");
    expect(relativeTime("2026-08-01T12:00:00Z", now)).toBe("2026-08-01");
    expect(relativeTime("not a date", now)).toBe("not a date");
  });
});
