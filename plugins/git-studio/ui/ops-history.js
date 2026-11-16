// The operations that move branches and rewrite history, as git arguments: branches, tags, merge,
// rebase, cherry-pick, revert, reset, the operation in progress (continue, skip, abort) and undo
// through the reflog. Nothing asks the person here; actions-history.js does.

/** @typedef {import("./repo.js").Runner} Runner */

/** @param {Runner} git @param {string} root */
export function createHistoryOps(git, root) {
  const at = { cwd: root };
  const net = { cwd: root, timeoutMs: 0 };
  /** @param {string[]} args */
  const run = (args, options = at) => git.run(args, options);
  /** Git's editor is never opened: sequences and messages take git's defaults. */
  const quiet = ["-c", "core.editor=true", "-c", "sequence.editor=true"];

  return {
    /** Whether `name` is a valid new branch name (git check-ref-format --branch). */
    validBranch: async (/** @type {string} */ name) => {
      if (!name || name.startsWith("-")) return false;
      return run(["check-ref-format", "--branch", name]).then(
        () => true,
        () => false,
      );
    },
    createBranch: (
      /** @type {string} */ name,
      /** @type {string} */ start,
      { checkout = false } = {},
    ) => run(checkout ? ["switch", "-c", name, start] : ["branch", name, start]),
    renameBranch: (/** @type {string} */ from, /** @type {string} */ to) =>
      run(["branch", "-m", from, to]),
    deleteBranch: (/** @type {string} */ name, { force = false } = {}) =>
      run(["branch", force ? "-D" : "-d", name]),
    deleteRemoteBranch: (/** @type {string} */ remote, /** @type {string} */ branch) =>
      run(["push", remote, "--delete", branch], net),
    setUpstream: (/** @type {string} */ branch, /** @type {string} */ upstream) =>
      run(["branch", `--set-upstream-to=${upstream}`, branch]),
    /** Move a branch that is not checked out to a commit (a fast-forward from the sidebar). */
    moveBranch: (/** @type {string} */ name, /** @type {string} */ to) =>
      run(["branch", "-f", name, to]),
    fetchRemote: (/** @type {string} */ remote) => run(["fetch", "--prune", remote], net),
    /** Switch to a branch by name, or detach at a commit id. */
    switchTo: (/** @type {string} */ ref) =>
      run(/^[0-9a-f]{7,64}$/.test(ref) ? ["switch", "--detach", ref] : ["switch", ref]),

    createTag: (
      /** @type {string} */ name,
      /** @type {string} */ sha,
      /** @type {string} */ message = "",
    ) => run(message ? ["tag", "-a", name, "-m", message, sha] : ["tag", name, sha]),
    deleteTag: (/** @type {string} */ name) => run(["tag", "-d", name]),
    pushTag: (/** @type {string} */ remote, /** @type {string} */ name) =>
      run(["push", remote, `refs/tags/${name}`], net),

    /** Merge `ref` into the current branch. */
    merge: (
      /** @type {string} */ ref,
      /** @type {{ mode?: "auto" | "no-ff" | "ff-only" | "squash" }} */ { mode = "auto" } = {},
    ) => run([...quiet, "merge", ...(mode === "auto" ? [] : [`--${mode}`]), "--no-edit", ref]),
    /** Replay the current branch on top of `onto`. */
    rebase: (/** @type {string} */ onto) => run([...quiet, "rebase", onto]),
    cherryPick: (/** @type {string} */ sha, { mainline = 0 } = {}) =>
      run([...quiet, "cherry-pick", ...(mainline ? ["-m", String(mainline)] : []), sha]),
    revert: (/** @type {string} */ sha, { mainline = 0 } = {}) =>
      run([...quiet, "revert", "--no-edit", ...(mainline ? ["-m", String(mainline)] : []), sha]),
    /** Move the current branch to `sha`: soft keeps the index, mixed the working copy, hard nothing. */
    reset: (/** @type {string} */ sha, /** @type {"soft" | "mixed" | "hard" | "keep"} */ mode) =>
      run(["reset", `--${mode}`, sha]),

    /** Go on with, skip a step of, or give up the merge, rebase, cherry-pick or revert in progress. */
    proceed: (
      /** @type {"merge" | "rebase" | "cherry-pick" | "revert"} */ op,
      /** @type {"continue" | "skip" | "abort"} */ how,
    ) =>
      op === "merge" && how === "continue"
        ? run([...quiet, "commit", "--no-edit"])
        : run([...quiet, op, `--${how}`]),

    /** The last moves of HEAD (reflog): what Undo would take back. */
    reflog: async (count = 20) => {
      const { stdout } = await run([
        "reflog",
        "show",
        `-n${count}`,
        "--format=%H%x1f%gs",
        "HEAD",
        "--",
      ]);
      return stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sha = "", message = ""] = line.split("\x1f");
          return { sha, message };
        });
    },
  };
}

/** @typedef {ReturnType<typeof createHistoryOps>} HistoryOps */
