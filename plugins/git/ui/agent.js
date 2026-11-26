// What an agent reads of a repository (endue.git.state, ADR 0088): plain data from the status view,
// with paths relative to the root as git prints them. No bridge, no DOM.

import { LOG_FORMAT, parseLog } from "./parse-log.js";
import {
  parseRecent,
  parseStashes,
  parseStatus,
  RECENT_FORMAT,
  STASH_FORMAT,
} from "./parse-status.js";
import { nameOf } from "./recent.js";

/**
 * @typedef {import("./parse-status.js").Entry} Entry
 * @typedef {import("./git.js").Repo} Repo
 * @typedef {import("./git.js").StatusView} StatusView
 * @typedef {import("./run.js").RunOptions} RunOptions
 * @typedef {import("./run.js").Outcome} Outcome
 * @typedef {(args: string[], options?: RunOptions) => Promise<Outcome>} Git
 * @typedef {import("@endue-ai/plugin-sdk").Invocation} Invocation
 * @typedef {(id: string, handler: (args: any, invocation?: Invocation) => unknown) => void} Answer
 */

/** @param {Entry} entry */
const change = ({ path, origPath, change }) => ({
  path,
  change,
  ...(origPath ? { origPath } : {}),
});

/**
 * @param {Repo} repo
 * @param {StatusView} view
 */
export function snapshot(repo, { status, stashes, recent }) {
  const { branch, upstream, ahead, behind, oid } = status.head;
  const max = 500;
  const capped = [status.staged, status.unstaged, status.untracked, status.conflicts, stashes].some(
    (items) => items.length > max,
  );
  return {
    root: repo.root,
    name: repo.name,
    branch,
    upstream,
    ahead,
    behind,
    head: oid,
    staged: status.staged.slice(0, max).map(change),
    unstaged: status.unstaged.slice(0, max).map(change),
    untracked: status.untracked.slice(0, max),
    conflicts: status.conflicts.slice(0, max).map(change),
    stashes: stashes.slice(0, max).map(({ ref, subject }) => ({ ref, subject })),
    recent: recent.map(({ sha, subject }) => ({ sha, subject })),
    ...(capped ? { truncated: true } : {}),
  };
}

/** @param {Git} run @param {string} path */
export async function repositoryAt(run, path) {
  if (!path.trim() || path.includes("\0")) throw new Error("Give the repository's folder.");
  const top = await run(["rev-parse", "--show-toplevel"], { cwd: path }).catch(
    (/** @type {Error & { outcome?: { code?: number | null } }} */ error) => {
      if (error.outcome?.code === 128) throw new Error(`Not a Git repository: ${path}.`);
      throw error;
    },
  );
  const root = top.stdout.trim();
  if (!root) throw new Error("Git did not return a repository folder.");
  return { root, name: nameOf(root) };
}

/** @param {Git} git */
export async function readStatus(git) {
  const [status, stashes, recent] = await Promise.all([
    git(["status", "--porcelain=v2", "--branch", "-z"]),
    git(["stash", "list", `--format=${STASH_FORMAT}`]),
    git(["log", "-n", "10", `--format=${RECENT_FORMAT}`], { ok: [128] }),
  ]);
  return {
    status: parseStatus(status.stdout),
    stashes: parseStashes(stashes.stdout),
    recent: recent.code === 0 ? parseRecent(recent.stdout) : [],
  };
}

/** @param {Git} git @param {{ count: number, skip: number, all: boolean }} query */
export async function readCommits(git, { count, skip, all }, allowEmpty = false) {
  const [remotes, log] = await Promise.all([
    git(["remote"]),
    git(
      [
        "log",
        "--topo-order",
        `--max-count=${count}`,
        ...(skip > 0 ? [`--skip=${skip}`] : []),
        `--format=${LOG_FORMAT}`,
        ...(all ? ["--all"] : ["HEAD"]),
        "--",
      ],
      allowEmpty ? { ok: [128] } : undefined,
    ),
  ]);
  return log.code === 0 ? parseLog(log.stdout, remotes.stdout.split("\n").filter(Boolean)) : [];
}

/** @param {unknown} value @param {string} what */
function stashRef(value, what) {
  if (typeof value !== "string" || !/^stash@\{[0-9]{1,9}\}$/u.test(value))
    throw new Error(`Give the stash reference as stash@{0} to ${what}.`);
  return value;
}

/**
 * @param {{
 *   answer: Answer, git: Git, run: Git, opened(): Repo, refresh(): Promise<void>,
 *   pick(title: string, items: Array<{id: string, label: string}>): Promise<unknown>,
 *   cancelled(message: string): Error,
 * }} deps
 */
export function wireRepositoryTools({ answer, git, run, opened, refresh, pick, cancelled }) {
  const at =
    (/** @type {Repo} */ repo) =>
    (/** @type {string[]} */ args, /** @type {RunOptions} */ options = {}) =>
      run(args, { ...options, cwd: repo.root });

  answer("endue.git.state", async ({ path }) => {
    const repo = typeof path === "string" && path !== "" ? await repositoryAt(run, path) : opened();
    return snapshot(repo, {
      repo,
      ...(await readStatus(at(repo))),
    });
  });

  answer("endue.git.commits", ({ count = 20, skip = 0, all = false }) => {
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 200 ||
      !Number.isInteger(skip) ||
      skip < 0 ||
      skip > 1_000_000
    ) {
      throw new Error("Use 1 to 200 commits and a nonnegative skip of at most 1000000.");
    }
    return readCommits(git, { count, skip, all: all === true }, true);
  });

  answer("endue.git.diff-text", async ({ path, staged = false, sha }) => {
    if (path !== undefined && (typeof path !== "string" || path === "" || path.includes("\0")))
      throw new Error("Give a file path relative to the repository.");
    if (sha !== undefined && (typeof sha !== "string" || !/^[0-9a-f]{4,64}$/iu.test(sha)))
      throw new Error("Give the commit's hexadecimal SHA.");
    const common = ["--no-ext-diff", "--no-textconv"];
    const args = sha
      ? ["--literal-pathspecs", "show", "--format=", ...common, sha, "--", ...(path ? [path] : [])]
      : [
          "--literal-pathspecs",
          "diff",
          ...common,
          ...(staged ? ["--cached"] : []),
          "--",
          ...(path ? [path] : []),
        ];
    const { stdout } = await git(args);
    return { text: stdout.slice(0, 65_536), truncated: stdout.length > 65_536 };
  });

  answer("endue.git.stash", async ({ message }) => {
    if (
      message !== undefined &&
      (typeof message !== "string" || message.length > 2_000 || message.includes("\0"))
    )
      throw new Error("Give a stash message of at most 2000 characters.");
    const scoped = at(opened());
    const read = async () =>
      (await scoped(["rev-parse", "--verify", "--quiet", "refs/stash"], { ok: [1] })).stdout.trim();
    const before = await read();
    await scoped(["stash", "push", ...(message ? ["-m", message] : [])]);
    const after = await read();
    await refresh().catch(() => {});
    return { ref: after && after !== before ? "stash@{0}" : null };
  });

  answer("endue.git.stash-pop", async ({ ref }) => {
    const named = stashRef(ref, "pop");
    const scoped = at(opened());
    try {
      await scoped(["stash", "pop", "--index", named]);
    } finally {
      await refresh().catch(() => {});
    }
    return { ref: named, popped: true };
  });

  answer("endue.git.stash-drop", async ({ ref }, invocation) => {
    const named = stashRef(ref, "drop");
    const scoped = at(opened());
    if (!invocation?.caller.startsWith("agent:")) {
      const read = async () => (await scoped(["rev-parse", "--verify", named])).stdout.trim();
      const expected = await read();
      const choice = await pick(`Delete ${named}?`, [
        { id: "no", label: "Keep the stash" },
        { id: "yes", label: "Delete it" },
      ]);
      if (choice !== "yes") throw cancelled("Kept the stash.");
      if ((await read()) !== expected)
        throw new Error("The stash changed during review. Look again.");
    }
    await scoped(["stash", "drop", named]);
    await refresh().catch(() => {});
    return { ref: named, dropped: true };
  });
}
