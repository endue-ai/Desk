// What Git Studio reads from a repository: its root, a snapshot of everything the window shows (the
// working copy, refs, the graph's commits, stashes, worktrees, an operation in progress) in parallel,
// and one commit's detail. Every read is one git command through the runner; nothing writes here.

import {
  EMPTY_TREE,
  LOG_FORMAT,
  parseChangedFiles,
  parseLog,
  parseRefs,
  parseStashes,
  parseWorktrees,
  REF_FORMAT,
  STASH_FORMAT,
  splitMessage,
} from "./parse.js";
import { emptyStatus, parseStatus } from "./parse-status.js";

/**
 * @typedef {{ run(args: string[], options?: import("./run.js").RunOptions): Promise<import("./run.js").Outcome> }} Runner
 * @typedef {"merge" | "rebase" | "cherry-pick" | "revert" | null} Operation
 * @typedef {{ name: string, url: string }} Remote
 * @typedef {{
 *   root: string, name: string, status: import("./parse-status.js").Status,
 *   refs: import("./parse.js").Ref[], commits: import("./parse.js").Commit[], more: boolean,
 *   stashes: import("./parse.js").Stash[], worktrees: import("./parse.js").Worktree[],
 *   remotes: Remote[], operation: Operation, operationHead: string | null, user: string,
 * }} Snapshot
 * @typedef {{ sha: string, parents: string[], author: string, email: string, date: number,
 *   committer: string, committerEmail: string, committerDate: number, summary: string, body: string,
 *   files: import("./parse.js").ChangedFile[] }} CommitDetail
 */

/** The repository's top folder, or an Error that says the path is not in one. */
export async function findRoot(/** @type {Runner} */ git, /** @type {string} */ path) {
  try {
    const { stdout } = await git.run(["rev-parse", "--show-toplevel"], { cwd: path });
    return stdout.trim();
  } catch {
    throw new Error(`Not a Git repository: ${path}.`);
  }
}

/** The last folder of a path: the name a repository goes by. */
export const nameOf = (/** @type {string} */ root) =>
  root
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || root;

/**
 * @param {Runner} git
 * @param {string} root
 * @param {{ limit?: number, scope?: "all" | "current" }} [options]
 * @returns {Promise<Snapshot>}
 */
export async function loadSnapshot(git, root, options = {}) {
  const limit = options.limit ?? 400;
  const at = { cwd: root };
  const quiet = (/** @type {Promise<{ stdout: string }>} */ run) =>
    run.catch(() => ({ stdout: "" }));
  const [status, refs, stashes, worktrees, remotes, user, operation] = await Promise.all([
    git
      .run(
        ["status", "--porcelain=v2", "--branch", "--show-stash", "-z", "--untracked-files=all"],
        at,
      )
      .then(({ stdout }) => parseStatus(stdout)),
    git
      .run(
        ["for-each-ref", `--format=${REF_FORMAT}`, "refs/heads", "refs/remotes", "refs/tags"],
        at,
      )
      .then(({ stdout }) => parseRefs(stdout)),
    quiet(git.run(["stash", "list", `--format=${STASH_FORMAT}`], at)).then(({ stdout }) =>
      parseStashes(stdout),
    ),
    quiet(git.run(["worktree", "list", "--porcelain"], at)).then(({ stdout }) =>
      parseWorktrees(stdout),
    ),
    quiet(git.run(["remote", "-v"], at)).then(({ stdout }) => parseRemotes(stdout)),
    quiet(git.run(["config", "user.name"], at)).then(({ stdout }) => stdout.trim()),
    detectOperation(git, root),
  ]);
  let commits = /** @type {import("./parse.js").Commit[]} */ ([]);
  if (status.oid !== null || refs.length > 0) {
    const scope =
      options.scope === "current" ? ["HEAD"] : ["--branches", "--remotes", "--tags", "HEAD"];
    const { stdout } = await git
      .run(["log", "--date-order", `--format=${LOG_FORMAT}`, `-n${limit + 1}`, ...scope, "--"], at)
      .catch(() => ({ stdout: "" }));
    commits = parseLog(stdout);
  }
  const more = commits.length > limit;
  return {
    root,
    name: nameOf(root),
    status: status ?? emptyStatus(),
    refs,
    commits: more ? commits.slice(0, limit) : commits,
    more,
    stashes,
    worktrees,
    remotes,
    operation: operation.kind,
    operationHead: operation.head,
    user,
  };
}

/** `remote -v`: each remote once, by its fetch URL. */
export function parseRemotes(/** @type {string} */ out) {
  /** @type {Map<string, string>} */
  const remotes = new Map();
  for (const line of out.split("\n")) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
    if (match && !remotes.has(match[1] ?? "")) remotes.set(match[1] ?? "", match[2] ?? "");
  }
  return [...remotes].map(([name, url]) => ({ name, url }));
}

const OPERATIONS = /** @type {const} */ ([
  ["merge", "MERGE_HEAD"],
  ["rebase", "REBASE_HEAD"],
  ["cherry-pick", "CHERRY_PICK_HEAD"],
  ["revert", "REVERT_HEAD"],
]);

/** Which of merge, rebase, cherry-pick or revert stopped half way, and the commit it brings in. */
export async function detectOperation(/** @type {Runner} */ git, /** @type {string} */ root) {
  const found = await Promise.all(
    OPERATIONS.map(([, ref]) =>
      git
        .run(["rev-parse", "-q", "--verify", ref], { cwd: root, ok: [1] })
        .then(({ stdout }) => stdout.trim())
        .catch(() => ""),
    ),
  );
  const at = found.findIndex((sha) => sha !== "");
  const entry = OPERATIONS[at];
  return entry ? { kind: entry[0], head: found[at] || null } : { kind: null, head: null };
}

const DETAIL_FORMAT = ["%H", "%P", "%an", "%ae", "%at", "%cn", "%ce", "%ct", "%B"].join("%x1f");

/** One commit's message, people and the files it changes against its first parent. */
export async function loadCommit(
  /** @type {Runner} */ git,
  /** @type {string} */ root,
  /** @type {string} */ sha,
) {
  const at = { cwd: root };
  const { stdout } = await git.run(["show", "-s", `--format=${DETAIL_FORMAT}`, sha, "--"], at);
  const [
    full = "",
    parents = "",
    author = "",
    email = "",
    date = "",
    committer = "",
    cemail = "",
    cdate = "",
    ...message
  ] = stdout.split("\x1f");
  const parentList = parents === "" ? [] : parents.split(" ");
  const base = parentList[0] ?? EMPTY_TREE;
  const range = [base, full];
  const [names, numbers] = await Promise.all([
    git.run(["diff", "--name-status", "-z", "-M", ...range, "--"], at),
    git.run(["diff", "--numstat", "-z", "-M", ...range, "--"], at),
  ]);
  const { summary, body } = splitMessage(message.join("\x1f"));
  /** @type {CommitDetail} */
  const detail = {
    sha: full,
    parents: parentList,
    author,
    email,
    date: Number(date) || 0,
    committer,
    committerEmail: cemail,
    committerDate: Number(cdate) || 0,
    summary,
    body,
    files: parseChangedFiles(names.stdout, numbers.stdout),
  };
  return detail;
}

/**
 * @typedef {{ kind: "unstaged" | "staged" | "commit", path: string, origPath?: string,
 *   untracked?: boolean, sha?: string, parent?: string | null }} DiffTarget
 * @typedef {{ context?: number, ignoreSpace?: boolean }} DiffOptions
 */

/** The unified diff of one file: in the working copy, the index, or a commit against its parent. */
export async function loadDiff(
  /** @type {Runner} */ git,
  /** @type {string} */ root,
  /** @type {DiffTarget} */ target,
  /** @type {DiffOptions} */ options = {},
) {
  const flags = [`-U${options.context ?? 3}`, "--no-color", "--no-ext-diff", "-M"];
  if (options.ignoreSpace) flags.push("-w");
  const paths = target.origPath ? [target.origPath, target.path] : [target.path];
  /** @type {string[]} */
  let args;
  if (target.kind === "unstaged" && target.untracked)
    args = ["diff", ...flags, "--no-index", "--", "/dev/null", target.path];
  else if (target.kind === "unstaged") args = ["diff", ...flags, "--", ...paths];
  else if (target.kind === "staged") args = ["diff", "--cached", ...flags, "--", ...paths];
  else args = ["diff", ...flags, target.parent ?? EMPTY_TREE, target.sha ?? "HEAD", "--", ...paths];
  const { stdout } = await git.run(args, { cwd: root, ok: [1] });
  return stdout;
}
