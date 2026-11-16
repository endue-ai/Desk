// What Git Studio changes in a repository: each operation is the git arguments it runs, built here
// so the commands, menus, toolbar and agents run the same ones. Network operations wait as long as
// they take (timeoutMs 0) and can be cancelled; nothing here asks the person, the callers do.

/**
 * @typedef {import("./repo.js").Runner} Runner
 * @typedef {{ remote?: string, prune?: boolean }} FetchOptions
 * @typedef {{ mode?: "ff" | "rebase" | "merge" }} PullOptions
 * @typedef {{ remote?: string, branch?: string, force?: boolean, setUpstream?: boolean, tags?: boolean }} PushOptions
 */

/** @param {Runner} git @param {string} root */
export function createOps(git, root) {
  const at = { cwd: root };
  const net = { cwd: root, timeoutMs: 0 };
  /** @param {string[]} args */
  const run = (args, options = at) => git.run(args, options);

  return {
    /** @param {FetchOptions} [options] */
    fetch: (options = {}) =>
      run(
        [
          "fetch",
          ...(options.prune === false ? [] : ["--prune"]),
          ...(options.remote ? [options.remote] : ["--all"]),
        ],
        net,
      ),
    /** @param {PullOptions} [options] */
    pull: (options = {}) =>
      run(
        [
          "pull",
          options.mode === "rebase"
            ? "--rebase"
            : options.mode === "merge"
              ? "--no-rebase"
              : "--ff-only",
        ],
        net,
      ),
    /** @param {PushOptions} [options] */
    push: (options = {}) => {
      const args = ["push"];
      if (options.force) args.push("--force-with-lease");
      if (options.setUpstream) args.push("-u");
      if (options.tags) args.push("--tags");
      if (options.remote) args.push(options.remote);
      if (options.remote && options.branch) args.push(options.branch);
      return run(args, net);
    },
    /** Switch to a local branch, a remote one (tracked under its own name) or a commit. */
    checkout: (
      /** @type {{ ref: string, remote?: boolean, detach?: boolean }} */ { ref, remote, detach },
    ) => {
      if (remote) {
        const local = ref.replace(/^[^/]+\//, "");
        return run(["switch", "--track", "-c", local, ref]);
      }
      if (detach) return run(["switch", "--detach", ref]);
      return run(["switch", ref]);
    },

    /** Put files into the index; every change when `paths` is empty. */
    stage: (/** @type {string[]} */ paths) =>
      run(paths.length ? ["add", "-A", "--", ...paths] : ["add", "-A"]),
    /** Take files out of the index (before the first commit, `rm --cached`). */
    unstage: async (/** @type {string[]} */ paths, { born = true } = {}) => {
      if (!born)
        return run(["rm", "-r", "-q", "--cached", "--", ...(paths.length ? paths : ["."])]);
      return run(
        paths.length ? ["restore", "--staged", "--", ...paths] : ["restore", "--staged", "--", "."],
      );
    },
    /** Throw away the working copy's changes of tracked files, and untracked files themselves. */
    discard: async (
      /** @type {{ tracked: string[], untracked: string[] }} */ { tracked, untracked },
    ) => {
      if (tracked.length) await run(["restore", "--worktree", "--", ...tracked]);
      if (untracked.length) await run(["clean", "-f", "-d", "-q", "--", ...untracked]);
      return { stdout: "", stderr: "", code: 0, signal: null };
    },
    /** Commit what is staged with `message` on git's stdin; resolves with the new commit's id. */
    commit: async (
      /** @type {{ message: string, amend?: boolean, signOff?: boolean, allowEmpty?: boolean }} */ options,
    ) => {
      const args = ["commit", "-q", "--cleanup=strip", "-F", "-"];
      if (options.amend) args.push("--amend");
      if (options.signOff) args.push("--signoff");
      if (options.allowEmpty) args.push("--allow-empty");
      await run(args, { cwd: root, input: options.message });
      const { stdout } = await run(["rev-parse", "HEAD"]);
      return stdout.trim();
    },
    /** Put the working copy's changes away (untracked files too, unless told otherwise). */
    stashPush: (
      /** @type {{ message?: string, untracked?: boolean, keepIndex?: boolean }} */ options = {},
    ) => {
      const args = ["stash", "push"];
      if (options.untracked !== false) args.push("--include-untracked");
      if (options.keepIndex) args.push("--keep-index");
      if (options.message) args.push("-m", options.message);
      return run(args);
    },
    stashPop: (index = 0) => run(["stash", "pop", "--index", `stash@{${index}}`]),
    stashApply: (index = 0) => run(["stash", "apply", "--index", `stash@{${index}}`]),
    stashDrop: (index = 0) => run(["stash", "drop", `stash@{${index}}`]),

    /** The last commit's message, for amending it. */
    lastMessage: async () => (await run(["log", "-1", "--format=%B"])).stdout.replace(/\s+$/, ""),

    /**
     * Apply a patch (parse-diff's hunkPatch) on git's stdin: to the index (`cached`), backwards
     * (`reverse`, to unstage or discard), or to the working copy.
     */
    applyPatch: (
      /** @type {string} */ patch,
      /** @type {{ cached?: boolean, reverse?: boolean }} */ options = {},
    ) =>
      run(
        [
          "apply",
          ...(options.cached ? ["--cached"] : []),
          ...(options.reverse ? ["--reverse"] : []),
          "--whitespace=nowarn",
          "-",
        ],
        { cwd: root, input: patch },
      ),
  };
}

/** @typedef {ReturnType<typeof createOps>} Ops */
