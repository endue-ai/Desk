// Explicit repository edits from the command registry. Git operations themselves are shared
// with the window. A reviewed agent invocation reaches the handler after the core's approval.
import { argument, commitAt, isAgent, pathInRepo } from "./command-input.js";
import { createOps } from "./ops.js";
import { createHistoryOps } from "./ops-history.js";
import { confirm } from "./overlay.js";
import { parseStatus } from "./parse-status.js";
import { detectOperation } from "./repo.js";

/** @param {unknown} value */
function pathsOf(value) {
  if (!Array.isArray(value)) throw new Error("Give a list of file paths.");
  return [...new Set(value.map(pathInRepo))];
}

/** @param {unknown} value */
function stashIndex(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Give the stash's index.");
  return value;
}

/** @param {import("./command-input.js").Register} on @param {ReturnType<typeof import("./studio.js").createStudio>} studio @param {() => string} need */
export function registerWrites(on, { app, history, layer }, need) {
  const git = app.git;
  /** @param {string} label @param {() => Promise<unknown>} work */
  const change = async (label, work) => {
    await app.act(label, work, { propagate: true });
    return { ok: true };
  };
  /** @param {string} root */
  const requireRoot = (root) => {
    const cwd = need();
    if (root !== cwd) throw new Error("The named repository is no longer open.");
    return cwd;
  };
  /** @param {import("./command-input.js").Invocation | undefined} invocation @param {string} title @param {string} body */
  const review = async (invocation, title, body) => {
    if (isAgent(invocation)) return;
    if (!(await confirm(layer, { title, body, danger: true, confirm: "Continue" })))
      throw new Error("The Git operation was cancelled.");
  };
  /** @param {string} cwd @param {unknown} input */
  const branchName = async (cwd, input) => {
    const name = argument(input, "a branch name");
    await git.run(["check-ref-format", `refs/heads/${name}`], { cwd });
    return name;
  };

  on("unstage", async ({ paths = [] }) => {
    const cwd = need();
    const files = pathsOf(paths);
    const head = await git.run(["rev-parse", "--quiet", "--verify", "HEAD"], { cwd, ok: [1] });
    return change("Unstaged", () => createOps(git, cwd).unstage(files, { born: head.code === 0 }));
  });
  on("stash", ({ message, untracked = true, keepIndex = false }) => {
    const ops = createOps(git, need());
    return change("Stashed", () => ops.stashPush({ message, untracked, keepIndex }));
  });
  on("stash-apply", ({ index = 0 }) => {
    const ops = createOps(git, need());
    return change("Applied the stash", () => ops.stashApply(stashIndex(index)));
  });
  on("stash-pop", ({ index = 0 }) => {
    const ops = createOps(git, need());
    return change("Popped the stash", () => ops.stashPop(stashIndex(index)));
  });
  on("drop-stash", async ({ root, index, sha }, invocation) => {
    const cwd = requireRoot(root);
    const n = stashIndex(index);
    await review(invocation, "Drop this stash?", `Drop stash@{${n}} in ${cwd}.`);
    requireRoot(root);
    const actual = await git.run(["rev-parse", "--verify", `stash@{${n}}`], { cwd });
    if (actual.stdout.trim() !== sha)
      throw new Error("The stash changed. Read the stash list again.");
    return change("Dropped the stash", () => createOps(git, cwd).stashDrop(n));
  });
  on("discard", async ({ root, paths }, invocation) => {
    const cwd = requireRoot(root);
    const files = pathsOf(paths);
    if (!files.length) throw new Error("Give the files to discard.");
    await review(invocation, "Discard these changes?", `Discard ${files.join(", ")} in ${cwd}.`);
    requireRoot(root);
    const { stdout } = await git.run(["status", "--porcelain=v2", "-z", "--untracked-files=all"], {
      cwd,
    });
    const status = parseStatus(stdout);
    const found = files.map((path) => status.unstaged.find((f) => f.path === path));
    if (found.some((f) => !f)) throw new Error("Select files with unstaged changes to discard.");
    const tracked = found.flatMap((f) => (f && f.change !== "?" ? [f.path] : []));
    const untracked = found.flatMap((f) => (f?.change === "?" ? [f.path] : []));
    return change("Discarded", () => createOps(git, cwd).discard({ tracked, untracked }));
  });

  on("merge", async ({ ref, mode = "auto" }) => {
    if (!["auto", "no-ff", "ff-only", "squash"].includes(mode))
      throw new Error("Give a merge mode.");
    const cwd = need();
    const sha = await commitAt(git, cwd, ref);
    return change("Merged", () => createHistoryOps(git, cwd).merge(sha, { mode }));
  });
  on("rebase", async ({ onto }) => {
    const cwd = need();
    const sha = await commitAt(git, cwd, onto);
    return change("Rebased", () => createHistoryOps(git, cwd).rebase(sha));
  });
  /** @param {"cherry-pick" | "revert"} kind @param {{ sha: string, mainline?: number }} args */
  const commitChange = async (kind, { sha, mainline }) => {
    const cwd = need();
    const commit = await commitAt(git, cwd, sha);
    const ops = createHistoryOps(git, cwd);
    if (mainline === undefined) {
      const { stdout } = await git.run(["show", "-s", "--format=%P", commit, "--"], { cwd });
      mainline = stdout.trim().split(" ").length > 1 ? 1 : 0;
    }
    if (!Number.isSafeInteger(mainline) || mainline < 0) throw new Error("Give a parent number.");
    return kind === "revert"
      ? change("Reverted", () => ops.revert(commit, { mainline }))
      : change("Cherry-picked", () => ops.cherryPick(commit, { mainline }));
  };
  on("cherry-pick", (args) => commitChange("cherry-pick", args));
  on("revert", (args) => commitChange("revert", args));
  on("tag", async ({ name, sha, message = "" }) => {
    const cwd = need();
    const label = argument(name, "the new tag name");
    await git.run(["check-ref-format", `refs/tags/${label}`], { cwd });
    const commit = await commitAt(git, cwd, sha);
    return change(`Tagged ${label}`, () =>
      createHistoryOps(git, cwd).createTag(label, commit, message),
    );
  });
  on("rename-branch", async ({ from, to }) => {
    const cwd = need();
    const [oldName, newName] = await Promise.all([branchName(cwd, from), branchName(cwd, to)]);
    return change(`Renamed ${oldName}`, () =>
      createHistoryOps(git, cwd).renameBranch(oldName, newName),
    );
  });
  on("set-upstream", async ({ branch, upstream }) => {
    const cwd = need();
    const name = await branchName(cwd, branch);
    const ref = argument(upstream, "a remote tracking branch");
    await git.run(["show-ref", "--verify", `refs/remotes/${ref}`], { cwd });
    return change(`Set the upstream of ${name}`, () =>
      createHistoryOps(git, cwd).setUpstream(name, ref),
    );
  });
  on("delete-branch", async ({ root, name, force = false }, invocation) => {
    const cwd = requireRoot(root);
    const branch = await branchName(cwd, name);
    await review(invocation, "Delete this branch?", `Delete ${branch} in ${cwd}.`);
    requireRoot(root);
    return change(`Deleted ${branch}`, () =>
      createHistoryOps(git, cwd).deleteBranch(branch, { force }),
    );
  });
  on("reset", async ({ sha, mode = "mixed" }) => {
    if (mode !== "mixed" && mode !== "soft")
      throw new Error("Use the reviewed hard reset command for a hard reset.");
    const cwd = need();
    const commit = await commitAt(git, cwd, sha);
    if (mode === "mixed") {
      const { stdout } = await git.run(["status", "--porcelain=v2", "-z", "--untracked-files=no"], {
        cwd,
      });
      const status = parseStatus(stdout);
      const unstaged = new Set(status.unstaged.map((f) => f.path));
      if (status.staged.some((f) => unstaged.has(f.path)))
        throw new Error("Keep staged changes by using a soft reset for partially staged files.");
    }
    return change("Reset", () => createHistoryOps(git, cwd).reset(commit, mode));
  });
  on("reset-hard", async ({ root, sha }, invocation) => {
    const cwd = requireRoot(root);
    const commit = await commitAt(git, cwd, sha);
    if (commit !== sha) throw new Error("Give the full commit SHA for a hard reset.");
    await review(
      invocation,
      "Hard reset this repository?",
      `Reset ${cwd} to ${commit} and discard local changes.`,
    );
    requireRoot(root);
    return change("Reset", () => createHistoryOps(git, cwd).reset(commit, "hard"));
  });
  on("proceed", async ({ root, operation, how }, invocation) => {
    const cwd = requireRoot(root);
    if (!["continue", "abort", "skip"].includes(how)) throw new Error("Give a next step.");
    await review(invocation, "Run this Git operation?", `${how} the ${operation} in ${cwd}.`);
    requireRoot(root);
    const active = await detectOperation(git, cwd);
    if (!active.kind || operation !== active.kind)
      throw new Error("The active Git operation changed.");
    return change("Ran the Git operation", () =>
      createHistoryOps(git, cwd).proceed(active.kind, how),
    );
  });
  on("undo", (_args, invocation) => history.undo({ agent: isAgent(invocation) }));
  on("redo", (_args, invocation) => history.redo({ agent: isAgent(invocation) }));
}
