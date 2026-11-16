// What Git Studio changes in a repository: each operation is the git arguments it runs, built here
// so the commands, menus, toolbar and agents run the same ones. Network operations wait as long as
// they take (timeoutMs 0) and can be cancelled; nothing here asks the person, the callers do.

/**
 * @typedef {import("./repo.js").Runner} Runner
 * @typedef {{ remote?: string, prune?: boolean }} FetchOptions
 * @typedef {{ rebase?: boolean }} PullOptions
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
    pull: (options = {}) => run(["pull", options.rebase ? "--rebase" : "--ff-only"], net),
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
  };
}

/** @typedef {ReturnType<typeof createOps>} Ops */
