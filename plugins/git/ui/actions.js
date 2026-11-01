// What the Git surface does to a repository: stage, unstage, discard, commit, fetch, pull, push and
// switch branches. Every action runs git without a shell with `--` before any path, confirms what
// cannot be undone through the desk's pick, and ends with a refresh. No DOM: the view and the
// controller hand in what it needs, so the SDK's test host runs it against a scripted git.

/**
 * @typedef {import("./parse-status.js").StatusModel} StatusModel
 * @typedef {import("./settings.js").Settings} Settings
 * @typedef {import("./run.js").RunOptions} RunOptions
 * @typedef {import("./run.js").Outcome} Outcome
 * @typedef {{ kind: "file", section: "staged" | "unstaged" | "untracked" | "conflicts", path: string }
 *   | { kind: "section", section: string }
 *   | { kind: "commit", sha: string }
 *   | { kind: "stash", ref: string }
 *   | { kind: "hunk", path: string, index: number }
 *   | { kind: "line", path: string, index: number }} Item
 * @typedef {{ amend: boolean, signOff: boolean, staged: number, message: string }} CommitEditor
 * @typedef {{ id: string, label: string, detail?: string }} PickItem
 * @typedef {{
 *   git(args: string[], options?: RunOptions): Promise<Outcome>,
 *   cancel(): void,
 *   status(): StatusModel,
 *   settings(): Settings,
 *   selection(): Item | undefined,
 *   refresh(): Promise<void>,
 *   say(text: string): void,
 *   pick(title: string, items: PickItem[], free?: boolean, placeholder?: string): Promise<string | undefined>,
 *   editor(model: CommitEditor | null): void,
 *   openFile(path: string): Promise<void>,
 *   cancelled(message: string): Error,
 * }} Deps
 */

const NO_STDIN =
  "Staging part of a file needs git to read a patch, which bridge v0 cannot close: stage the whole file.";

/** @param {Deps} deps */
export function createActions(deps) {
  const { git, say, refresh } = deps;

  /** The file an action works on: the one named, else the selection. */
  const fileOf = (
    /** @type {{ path?: string } | undefined} */ args,
    /** @type {string} */ what,
  ) => {
    if (args?.path) return { kind: "file", path: args.path, section: "unstaged" };
    const item = deps.selection();
    if (item?.kind === "hunk" || item?.kind === "line") throw new Error(NO_STDIN);
    if (item?.kind === "file" || item?.kind === "section") return item;
    throw new Error(`Select a file to ${what}.`);
  };

  /** Paths are passed after `--`; one that starts with a dash would otherwise be an option. */
  const paths = (/** @type {string[]} */ list) => {
    for (const path of list) if (path === "") throw new Error("A path is empty.");
    return ["--", ...list];
  };

  /** Ask before something that cannot be undone; `confirm: false` in the settings skips the ask. */
  const confirm = async (/** @type {string} */ question, /** @type {string} */ yes) => {
    if (!deps.settings().confirm) return true;
    const answer = await deps.pick(question, [
      { id: "yes", label: yes },
      { id: "no", label: "Keep everything as it is" },
    ]);
    return answer === "yes";
  };

  const done = async (/** @type {string} */ words) => {
    await refresh();
    say(words);
  };

  /** @param {{ path?: string, all?: boolean }} [args] */
  const stage = async (args) => {
    if (args?.all) {
      await git(["add", "-A"]);
      return done("Staged everything.");
    }
    const target = fileOf(args, "stage");
    if (target.kind === "section") {
      if (target.section === "untracked") await git(["add", ...paths(deps.status().untracked)]);
      else if (target.section === "unstaged") await git(["add", "-u"]);
      else if (target.section === "conflicts")
        await git(["add", ...paths(deps.status().conflicts.map((c) => c.path))]);
      else return;
      return done(`Staged the ${target.section} files.`);
    }
    await git(["add", "-A", ...paths([target.path])]);
    await done(`Staged ${target.path}.`);
  };

  /** Without a commit yet there is no HEAD to restore from, so the index entry is removed instead. */
  const unstageArgs = (/** @type {string[]} */ list) =>
    deps.status().head.oid === null
      ? ["rm", "--cached", "-q", "-r", ...paths(list.length > 0 ? list : ["."])]
      : ["restore", "--staged", ...paths(list.length > 0 ? list : ["."])];

  /** @param {{ path?: string, all?: boolean }} [args] */
  const unstage = async (args) => {
    if (args?.all) {
      await git(unstageArgs([]));
      return done("Unstaged everything.");
    }
    const target = fileOf(args, "unstage");
    if (target.kind === "section") {
      if (target.section !== "staged") return;
      await git(unstageArgs([]));
      return done("Unstaged everything.");
    }
    await git(unstageArgs([target.path]));
    await done(`Unstaged ${target.path}.`);
  };

  /** @param {{ path?: string }} [args] */
  const discard = async (args) => {
    const target = fileOf(args, "discard");
    const status = deps.status();
    if (target.kind === "section") {
      if (target.section === "untracked") {
        if (!(await confirm("Delete every untracked file?", "Delete them"))) return;
        await git(["clean", "-fdq"]);
        return done("Deleted the untracked files.");
      }
      if (target.section !== "unstaged") return;
      if (!(await confirm("Discard every unstaged change?", "Discard them"))) return;
      await git(["restore", "--worktree", "--", "."]);
      return done("Discarded the unstaged changes.");
    }
    const untracked = status.untracked.includes(target.path);
    const what = untracked ? `Delete ${target.path}?` : `Discard the changes to ${target.path}?`;
    if (!(await confirm(what, untracked ? "Delete it" : "Discard them"))) return;
    if (untracked) await git(["clean", "-fdq", ...paths([target.path])]);
    else await git(["restore", "--worktree", ...paths([target.path])]);
    await done(untracked ? `Deleted ${target.path}.` : `Discarded the changes to ${target.path}.`);
  };

  /** @type {{ resolve(sha: string): void, reject(error: Error): void } | null} */
  let editing = null;

  /**
   * `git commit -m`. Without a message the editor opens and the command waits for it: Mod+Enter
   * commits, Escape answers `cancelled`.
   * @param {{ message?: string, amend?: boolean, signOff?: boolean }} [args]
   * @returns {Promise<string>} The new commit's short sha.
   */
  const commit = async (args = {}) => {
    const amend = args.amend === true;
    const status = deps.status();
    if (!amend && status.staged.length === 0) throw new Error("Nothing is staged to commit.");
    if (args.message !== undefined) return write(args.message, amend, args.signOff);
    let message = "";
    if (amend) message = (await git(["log", "-1", "--format=%B"])).stdout.replace(/\n+$/, "\n");
    if (editing) editing.reject(deps.cancelled("Replaced by a new commit."));
    deps.editor({ amend, signOff: deps.settings().signOff, staged: status.staged.length, message });
    return new Promise((resolve, reject) => {
      editing = { resolve, reject };
    });
  };

  /**
   * @param {string} message
   * @param {boolean} amend
   * @param {boolean | undefined} signOff
   */
  const write = async (message, amend, signOff) => {
    const text = message.replace(/\r\n/g, "\n").trim();
    if (text === "") throw new Error("The commit message is empty.");
    const sign = signOff ?? deps.settings().signOff;
    await git([
      "commit",
      "-q",
      "--cleanup=strip",
      ...(amend ? ["--amend"] : []),
      ...(sign ? ["--signoff"] : []),
      "-m",
      `${text}\n`,
    ]);
    const sha = (await git(["rev-parse", "--short", "HEAD"])).stdout.trim();
    await done(`${amend ? "Amended" : "Committed"} ${sha}.`);
    return sha;
  };

  /** The editor's Mod+Enter. @param {string} message @param {{ amend: boolean, signOff: boolean }} options */
  const submitCommit = async (message, options) => {
    const pending = editing;
    try {
      const sha = await write(message, options.amend, options.signOff);
      editing = null;
      deps.editor(null);
      pending?.resolve(sha);
    } catch (error) {
      // The editor stays open with the message; the status line says why.
      say(error instanceof Error ? error.message : String(error));
    }
  };

  /** The editor's Escape. */
  const cancelCommit = () => {
    const pending = editing;
    editing = null;
    deps.editor(null);
    pending?.reject(deps.cancelled("The commit was cancelled."));
  };

  /** @param {{ remote?: string }} [args] */
  const fetch = async (args) => {
    say("Fetching…");
    await git(["fetch", "--prune", ...(args?.remote ? [args.remote] : [])], { timeoutMs: 0 });
    await done("Fetched.");
  };

  const pull = async () => {
    say("Pulling…");
    await git(["pull", deps.settings().pullRebase ? "--rebase" : "--ff-only"], { timeoutMs: 0 });
    await done("Pulled.");
  };

  /** @param {{ remote?: string, force?: boolean }} [args] */
  const push = async (args) => {
    const { upstream, branch } = deps.status().head;
    if (branch === null) throw new Error("HEAD is detached: switch to a branch before pushing.");
    if (args?.force && !(await confirm(`Force-push ${branch}?`, "Push with --force-with-lease")))
      return;
    const force = args?.force ? ["--force-with-lease"] : [];
    say("Pushing…");
    if (upstream === null) {
      const remote = args?.remote ?? (await pickRemote());
      if (remote === undefined) return;
      await git(["push", "-u", ...force, remote, "HEAD"], { timeoutMs: 0 });
      return done(`Pushed ${branch} to ${remote} and set it as the upstream.`);
    }
    await git(["push", ...force, ...(args?.remote ? [args.remote] : [])], { timeoutMs: 0 });
    await done(`Pushed ${branch}.`);
  };

  const remotes = async () =>
    (await git(["remote"])).stdout.split("\n").filter((line) => line !== "");

  const pickRemote = async () => {
    const all = await remotes();
    if (all.length === 0) throw new Error("The repository has no remote.");
    if (all.length === 1) return all[0];
    return deps.pick(
      "Push to which remote?",
      all.map((remote) => ({ id: remote, label: remote })),
    );
  };

  /**
   * `git switch`: an existing branch, a remote branch to track, or a new branch from the typed name.
   * @param {{ ref?: string }} [args]
   */
  const checkout = async (args) => {
    const known = await branches();
    const ref =
      args?.ref ??
      (await deps.pick(
        "Switch to which branch?",
        known.map((b) => ({ id: b.name, label: b.name, detail: b.detail })),
        true,
        "a branch name, new or existing",
      ));
    if (ref === undefined) return;
    const found = known.find((b) => b.name === ref);
    if (!found) {
      await git(["check-ref-format", "--branch", ref]);
      await git(["switch", "-q", "-c", ref]);
      return done(`Created and switched to ${ref}.`);
    }
    await git(found.remote ? ["switch", "-q", "--track", ref] : ["switch", "-q", ref]);
    await done(`Switched to ${ref}.`);
  };

  const branches = async () => {
    const remoteNames = await remotes();
    const { stdout } = await git([
      "for-each-ref",
      "--format=%(refname:short)%1f%(objectname:short)%1f%(upstream:short)",
      "refs/heads",
      "refs/remotes",
    ]);
    return stdout
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [name = "", sha = "", upstream = ""] = line.split("\x1f");
        const remote = remoteNames.some((r) => name.startsWith(`${r}/`));
        return { name, remote, detail: upstream ? `${sha} → ${upstream}` : sha };
      })
      .filter((branch) => !branch.name.endsWith("/HEAD"));
  };

  /** Open the selected file (or the one named) in the plugin the desk's files policy picks. */
  const visit = async (/** @type {{ path?: string }} */ args) => {
    const item = args?.path ? { path: args.path } : deps.selection();
    if (!item || !("path" in item)) throw new Error("Select a file to open.");
    await deps.openFile(item.path);
  };

  return {
    stage,
    stageAll: () => stage({ all: true }),
    unstage,
    unstageAll: () => unstage({ all: true }),
    discard,
    commit,
    amend: () => commit({ amend: true }),
    submitCommit,
    cancelCommit,
    fetch,
    pull,
    push,
    checkout,
    visit,
    cancel: () => {
      deps.cancel();
      say("Cancelled.");
    },
  };
}
