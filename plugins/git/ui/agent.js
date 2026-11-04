// What an agent reads of a repository (endue.git.state, ADR 0084): plain data from the status view,
// with paths relative to the root as git prints them. No bridge, no DOM.

/**
 * @typedef {import("./parse-status.js").Entry} Entry
 * @typedef {import("./git.js").Repo} Repo
 * @typedef {import("./git.js").StatusView} StatusView
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
  return {
    root: repo.root,
    name: repo.name,
    branch,
    upstream,
    ahead,
    behind,
    head: oid,
    staged: status.staged.map(change),
    unstaged: status.unstaged.map(change),
    untracked: [...status.untracked],
    conflicts: status.conflicts.map(change),
    stashes: stashes.map(({ ref, subject }) => ({ ref, subject })),
    recent: recent.map(({ sha, subject }) => ({ sha, subject })),
  };
}
