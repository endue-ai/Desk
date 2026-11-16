// `git status --porcelain=v2 --branch --show-stash -z --untracked-files=all` read into the working
// copy's state: the branch header, staged and unstaged changes, untracked files and conflicts.

/**
 * @typedef {{ path: string, change: string, origPath?: string, submodule?: boolean }} FileChange
 * @typedef {{ path: string, code: string, label: string }} Conflict
 * @typedef {{ oid: string | null, branch: string | null, detached: boolean, upstream: string | null,
 *   ahead: number, behind: number, stashCount: number, staged: FileChange[], unstaged: FileChange[],
 *   conflicts: Conflict[] }} Status
 */

/** @returns {Status} */
export function emptyStatus() {
  return {
    oid: null,
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    stashCount: 0,
    staged: [],
    unstaged: [],
    conflicts: [],
  };
}

/** What each unmerged pair of letters means, in words. */
export const CONFLICT_LABELS = Object.freeze({
  DD: "both deleted",
  AU: "added by us",
  UD: "deleted by them",
  UA: "added by them",
  DU: "deleted by us",
  AA: "both added",
  UU: "both modified",
});

export function parseStatus(/** @type {string} */ out) {
  const status = emptyStatus();
  const fields = out.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const line = fields[i] ?? "";
    if (line === "") continue;
    if (line.startsWith("# ")) {
      header(status, line.slice(2));
      continue;
    }
    const kind = line[0];
    if (kind === "?") {
      status.unstaged.push({ path: line.slice(2), change: "?" });
    } else if (kind === "1" || kind === "2") {
      const parts = line.split(" ");
      const xy = parts[1] ?? "..";
      const submodule = (parts[2] ?? "N").startsWith("S");
      const path = parts.slice(kind === "1" ? 8 : 9).join(" ");
      const origPath = kind === "2" ? (fields[++i] ?? "") : undefined;
      const x = xy[0] ?? ".";
      const y = xy[1] ?? ".";
      if (x !== ".") status.staged.push(change(path, x, origPath, submodule));
      if (y !== ".") status.unstaged.push(change(path, y, undefined, submodule));
    } else if (kind === "u") {
      const parts = line.split(" ");
      const code = parts[1] ?? "UU";
      const path = parts.slice(10).join(" ");
      status.conflicts.push({
        path,
        code,
        label: CONFLICT_LABELS[/** @type {keyof typeof CONFLICT_LABELS} */ (code)] ?? "unmerged",
      });
    }
  }
  return status;
}

/** @param {string} path @param {string} letter @param {string | undefined} origPath @param {boolean} submodule */
function change(path, letter, origPath, submodule) {
  /** @type {FileChange} */
  const file = { path, change: letter };
  if (origPath) file.origPath = origPath;
  if (submodule) file.submodule = true;
  return file;
}

/** @param {Status} status @param {string} line */
function header(status, line) {
  const at = line.indexOf(" ");
  const key = line.slice(0, at);
  const value = line.slice(at + 1);
  if (key === "branch.oid") status.oid = value === "(initial)" ? null : value;
  else if (key === "branch.head") {
    status.detached = value === "(detached)";
    status.branch = status.detached ? null : value;
  } else if (key === "branch.upstream") status.upstream = value;
  else if (key === "branch.ab") {
    status.ahead = Number(/\+(\d+)/.exec(value)?.[1] ?? 0);
    status.behind = Number(/-(\d+)/.exec(value)?.[1] ?? 0);
  } else if (key === "stash") status.stashCount = Number(value) || 0;
}

/** Every path the working copy changes, once. */
export function changeCount(/** @type {Status} */ status) {
  const paths = new Set();
  for (const file of [...status.staged, ...status.unstaged, ...status.conflicts])
    paths.add(file.path);
  return paths.size;
}
