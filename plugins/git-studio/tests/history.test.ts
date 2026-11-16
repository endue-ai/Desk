// The history operations against the real git: branches and tags, a merge that stops on a conflict
// (seen as an operation in progress) and its abort, cherry-pick, revert, reset and the reflog undo
// reads.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHistoryOps } from "../ui/ops-history.js";
import { loadSnapshot } from "../ui/repo.js";
import { realGit, tempRepo } from "./real-git";

let repo: Awaited<ReturnType<typeof tempRepo>>;
let ops: ReturnType<typeof createHistoryOps>;
beforeEach(async () => {
  repo = await tempRepo();
  ops = createHistoryOps(realGit, repo.root);
});
afterEach(() => repo.done());

const head = async () => (await repo.git("rev-parse", "HEAD")).stdout.trim();
const commit = async (file: string, text: string, message: string) => {
  repo.write(file, text);
  await repo.git("add", "-A");
  await repo.git("commit", "-q", "-m", message);
  return head();
};

describe("branches and tags", () => {
  it("validates, creates, renames and deletes branches", async () => {
    expect(await ops.validBranch("feature/ok")).toBe(true);
    expect(await ops.validBranch("bad..name")).toBe(false);
    expect(await ops.validBranch("-x")).toBe(false);
    await ops.createBranch("topic", "HEAD", { checkout: true });
    expect((await repo.git("branch", "--show-current")).stdout.trim()).toBe("topic");
    await ops.switchTo("main");
    await ops.renameBranch("topic", "topic2");
    await ops.deleteBranch("topic2");
    const s = await loadSnapshot(realGit, repo.root);
    expect(s.refs.filter((r) => r.kind === "head").map((r) => r.name)).toEqual(["main"]);
  });

  it("refuses to delete an unmerged branch until forced", async () => {
    await ops.createBranch("side", "HEAD", { checkout: true });
    await commit("b.txt", "b\n", "On side");
    await ops.switchTo("main");
    await expect(ops.deleteBranch("side")).rejects.toThrow(/not fully merged/);
    await ops.deleteBranch("side", { force: true });
  });

  it("creates annotated and light tags and deletes them", async () => {
    const sha = await head();
    await ops.createTag("v1", sha, "First release");
    await ops.createTag("light", sha);
    expect((await repo.git("cat-file", "-t", "v1")).stdout.trim()).toBe("tag");
    const s = await loadSnapshot(realGit, repo.root);
    expect(s.refs.filter((r) => r.kind === "tag").map((r) => [r.name, r.sha])).toEqual([
      ["light", sha],
      ["v1", sha],
    ]);
    await ops.deleteTag("v1");
  });
});

describe("merge, rebase, cherry-pick, revert", () => {
  it("stops a merge on a conflict, shows it in progress, and aborts it", async () => {
    await ops.createBranch("side", "HEAD", { checkout: true });
    await commit("a.txt", "side\n", "Side change");
    await ops.switchTo("main");
    await commit("a.txt", "main\n", "Main change");
    await expect(ops.merge("side")).rejects.toThrow();
    let s = await loadSnapshot(realGit, repo.root);
    expect(s.operation).toBe("merge");
    expect(s.status.conflicts).toEqual([{ path: "a.txt", code: "UU", label: "both modified" }]);
    await ops.proceed("merge", "abort");
    s = await loadSnapshot(realGit, repo.root);
    expect(s.operation).toBeNull();
    expect(s.status.conflicts).toEqual([]);
  });

  it("merges without a conflict, with a merge commit when asked", async () => {
    await ops.createBranch("side", "HEAD", { checkout: true });
    await commit("b.txt", "b\n", "Side file");
    await ops.switchTo("main");
    await ops.merge("side", { mode: "no-ff" });
    const parents = (await repo.git("log", "-1", "--format=%P")).stdout.trim().split(" ");
    expect(parents).toHaveLength(2);
  });

  it("rebases a branch on another", async () => {
    await ops.createBranch("side", "HEAD", { checkout: true });
    await commit("b.txt", "b\n", "Side file");
    await ops.switchTo("main");
    const tip = await commit("c.txt", "c\n", "Main file");
    await ops.switchTo("side");
    await ops.rebase("main");
    expect((await repo.git("rev-parse", "HEAD~1")).stdout.trim()).toBe(tip);
  });

  it("cherry-picks and reverts a commit", async () => {
    await ops.createBranch("side", "HEAD", { checkout: true });
    const picked = await commit("b.txt", "b\n", "Side file");
    await ops.switchTo("main");
    await ops.cherryPick(picked);
    expect((await repo.git("log", "-1", "--format=%s")).stdout.trim()).toBe("Side file");
    await ops.revert(await head());
    expect((await repo.git("log", "-1", "--format=%s")).stdout.trim()).toBe('Revert "Side file"');
  });
});

describe("reset and the reflog", () => {
  it("resets soft and keeps the changes staged, and the reflog names each move", async () => {
    const first = await head();
    await commit("a.txt", "two\n", "Second");
    await ops.reset(first, "soft");
    const s = await loadSnapshot(realGit, repo.root);
    expect(s.status.staged.map((f) => f.path)).toEqual(["a.txt"]);
    const log = await ops.reflog(3);
    expect(log[0]?.message).toMatch(/^reset: moving to/);
    expect(log[1]?.message).toBe("commit: Second");
  });
});
