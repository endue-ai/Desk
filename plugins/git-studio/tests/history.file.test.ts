// A file's history across a rename, blame by line, and the deep searches, against the real git.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blame, deepSearch, fileHistory } from "../ui/history.js";
import { realGit, tempRepo } from "./real-git";

let repo: Awaited<ReturnType<typeof tempRepo>>;
beforeEach(async () => {
  repo = await tempRepo();
});
afterEach(() => repo.done());

const commit = async (message: string) => {
  await repo.git("add", "-A");
  await repo.git("commit", "-q", "-m", message);
  return (await repo.git("rev-parse", "HEAD")).stdout.trim();
};

describe("fileHistory", () => {
  it("follows a file across a rename, newest first, with the path it had", async () => {
    repo.write("a.txt", "one\nline two\nline three\nline four\n");
    await commit("Grow a");
    await repo.git("mv", "a.txt", "b.txt");
    await commit("Rename a to b");
    repo.write("b.txt", "one\nline two\nline three\nline four\nfive\n");
    await commit("Grow b");
    const log = await fileHistory(realGit, repo.root, "b.txt");
    expect(log.map((c) => [c.subject, c.change, c.path, c.origPath ?? null])).toEqual([
      ["Grow b", "M", "b.txt", null],
      ["Rename a to b", "R", "b.txt", "a.txt"],
      ["Grow a", "M", "a.txt", null],
      ["First", "A", "a.txt", null],
    ]);
  });
});

describe("blame", () => {
  it("names the commit of each line", async () => {
    repo.write("a.txt", "one\ntwo\n");
    const second = await commit("Add two");
    const { lines, commits } = await blame(realGit, repo.root, "a.txt");
    expect(lines.map((l) => [l.line, l.text])).toEqual([
      [1, "one"],
      [2, "two"],
    ]);
    expect(lines[1]?.sha).toBe(second);
    expect(commits.get(second)).toMatchObject({
      author: "endue-team",
      email: "team@endue.ai",
      summary: "Add two",
    });
    expect(commits.get(lines[0]?.sha ?? "")?.summary).toBe("First");
  });
});

describe("deepSearch", () => {
  it("finds the commits that added or removed some text, and those that touched a path", async () => {
    repo.write("notes.md", "needle here\n");
    const added = await commit("Notes");
    repo.write("notes.md", "nothing\n");
    const removed = await commit("Clear notes");
    expect(await deepSearch(realGit, repo.root, "code", "needle")).toEqual(
      new Set([removed, added]),
    );
    const touched = await deepSearch(realGit, repo.root, "path", "NOTES");
    expect(touched).toEqual(new Set([removed, added]));
  });
});
