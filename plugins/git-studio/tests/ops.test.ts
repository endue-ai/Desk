// The operations against the real git: staging, unstaging, discarding, a commit whose message goes
// through stdin (amend and sign-off too), stashes, and the snapshot that reads it all back.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOps } from "../ui/ops.js";
import { loadCommit, loadSnapshot } from "../ui/repo.js";
import { realGit, tempRepo } from "./real-git";

let repo: Awaited<ReturnType<typeof tempRepo>>;
beforeEach(async () => {
  repo = await tempRepo();
});
afterEach(() => repo.done());

const snapshot = () => loadSnapshot(realGit, repo.root);

describe("the working copy", () => {
  it("stages and unstages one file and every change", async () => {
    const ops = createOps(realGit, repo.root);
    repo.write("a.txt", "two\n");
    repo.write("b.txt", "new\n");
    await ops.stage(["a.txt"]);
    let s = await snapshot();
    expect(s.status.staged.map((f) => f.path)).toEqual(["a.txt"]);
    expect(s.status.unstaged).toEqual([{ path: "b.txt", change: "?" }]);
    await ops.stage([]);
    s = await snapshot();
    expect(s.status.staged.map((f) => f.path).sort()).toEqual(["a.txt", "b.txt"]);
    await ops.unstage([]);
    s = await snapshot();
    expect(s.status.staged).toEqual([]);
  });

  it("discards a tracked change and deletes an untracked file", async () => {
    const ops = createOps(realGit, repo.root);
    repo.write("a.txt", "changed\n");
    repo.write("junk.txt", "x\n");
    await ops.discard({ tracked: ["a.txt"], untracked: ["junk.txt"] });
    expect(readFileSync(join(repo.root, "a.txt"), "utf8")).toBe("one\n");
    expect((await snapshot()).status.unstaged).toEqual([]);
  });

  it("commits a message with a body through stdin, then amends it with a sign-off", async () => {
    const ops = createOps(realGit, repo.root);
    repo.write("a.txt", "two\n");
    await ops.stage([]);
    const sha = await ops.commit({
      message: 'Second\n\nWhy it changed, with "quotes" and ünïcode.',
    });
    let detail = await loadCommit(realGit, repo.root, sha);
    expect(detail.summary).toBe("Second");
    expect(detail.body).toBe('Why it changed, with "quotes" and ünïcode.');
    expect(detail.files).toEqual([{ path: "a.txt", change: "M", added: 1, removed: 1 }]);
    expect(await ops.lastMessage()).toContain("Second");
    const amended = await ops.commit({ message: "Second, amended", amend: true, signOff: true });
    detail = await loadCommit(realGit, repo.root, amended);
    expect(detail.parents).toHaveLength(1);
    expect(detail.body).toContain("Signed-off-by: endue-team <team@endue.ai>");
  });

  it("stashes with untracked files and pops them back", async () => {
    const ops = createOps(realGit, repo.root);
    repo.write("a.txt", "wip\n");
    repo.write("new.txt", "n\n");
    await ops.stashPush({ message: "Half done" });
    let s = await snapshot();
    expect(s.status.unstaged).toEqual([]);
    expect(s.stashes.map((x) => x.message)).toEqual(["Half done"]);
    await ops.stashPop(0);
    s = await snapshot();
    expect(s.stashes).toEqual([]);
    expect(s.status.unstaged.map((f) => f.path).sort()).toEqual(["a.txt", "new.txt"]);
  });
});

describe("loadSnapshot", () => {
  it("reads the branch, the graph's commits, refs and a root commit's files", async () => {
    await repo.git("tag", "v1");
    const s = await snapshot();
    expect(s.status.branch).toBe("main");
    expect(s.commits).toHaveLength(1);
    expect(s.refs.map((r) => `${r.kind}:${r.name}`).sort()).toEqual(["head:main", "tag:v1"]);
    expect(s.operation).toBeNull();
    const root = await loadCommit(realGit, repo.root, s.commits[0]?.sha ?? "");
    expect(root.files).toEqual([{ path: "a.txt", change: "A", added: 1, removed: 0 }]);
  });
});
