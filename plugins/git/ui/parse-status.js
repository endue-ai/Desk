// Parsers for what the status view shows: `git status --porcelain=v2 --branch -z`, `git stash list`
// and the recent commits. Pure functions over the program's output: no bridge, no DOM, so vitest runs
// them on recorded output. Records are NUL-terminated, so paths with spaces or newlines survive.

/**
 * @typedef {"modified" | "added" | "deleted" | "renamed" | "copied" | "typechange" | "unmerged"} Change
 * @typedef {{ path: string, origPath?: string, change: Change, code: string, submodule: boolean }} Entry
 * @typedef {{ oid: string | null, branch: string | null, upstream: string | null, ahead: number, behind: number }} Head
 * @typedef {{ head: Head, staged: Entry[], unstaged: Entry[], untracked: string[], conflicts: Entry[] }} StatusModel
 * @typedef {{ ref: string, subject: string }} Stash
 * @typedef {{ sha: string, subject: string, refs: string[] }} RecentCommit
 */

/** @type {Record<string, Change>} */
const CHANGES = {
  M: "modified",
  T: "typechange",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "unmerged",
};

/** `1 XY sub mH mI mW hH hI path`: an ordinary changed entry. */
const ORDINARY = /^1 (\S\S) (\S{4}) \S+ \S+ \S+ \S+ \S+ (.*)$/s;
/** `2 XY sub mH mI mW hH hI Xscore path`, followed by the original path in its own record. */
const RENAMED = /^2 (\S\S) (\S{4}) \S+ \S+ \S+ \S+ \S+ [RC](\d+) (.*)$/s;
/** `u XY sub m1 m2 m3 mW h1 h2 h3 path`: an unmerged entry. */
const UNMERGED = /^u (\S\S) (\S{4}) \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/s;

/** The empty status: nothing known about the head, nothing changed. */
export const emptyStatus = () => ({
  head: { oid: null, branch: null, upstream: null, ahead: 0, behind: 0 },
  staged: [],
  unstaged: [],
  untracked: [],
  conflicts: [],
});

/**
 * @param {string} text The output of `git status --porcelain=v2 --branch -z`.
 * @returns {StatusModel}
 */
export function parseStatus(text) {
  const model = emptyStatus();
  const records = text.split("\0");
  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? "";
    if (record === "") continue;
    if (record.startsWith("# ")) {
      header(record.slice(2), model.head);
    } else if (record.startsWith("? ")) {
      model.untracked.push(record.slice(2));
    } else if (record.startsWith("1 ")) {
      ordinary(record, model);
    } else if (record.startsWith("2 ")) {
      i++;
      renamed(record, records[i] ?? "", model);
    } else if (record.startsWith("u ")) {
      unmerged(record, model);
    }
    // "! path" (ignored files) and anything unknown are left out.
  }
  return model;
}

/** @param {string} line @param {Head} head */
function header(line, head) {
  const space = line.indexOf(" ");
  const key = space < 0 ? line : line.slice(0, space);
  const value = space < 0 ? "" : line.slice(space + 1);
  if (key === "branch.oid") head.oid = value === "(initial)" ? null : value;
  else if (key === "branch.head") head.branch = value === "(detached)" ? null : value;
  else if (key === "branch.upstream") head.upstream = value;
  else if (key === "branch.ab") {
    const match = /^\+(\d+) -(\d+)$/.exec(value);
    head.ahead = Number(match?.[1] ?? 0);
    head.behind = Number(match?.[2] ?? 0);
  }
}

/**
 * @param {string} xy
 * @param {string} sub
 * @param {string} path
 * @param {StatusModel} model
 * @param {string} [origPath]
 */
function place(xy, sub, path, model, origPath) {
  const [x = ".", y = "."] = xy;
  const submodule = sub.startsWith("S");
  if (x !== ".") {
    const change = CHANGES[x] ?? "modified";
    model.staged.push({ path, ...(origPath ? { origPath } : {}), change, code: xy, submodule });
  }
  if (y !== ".")
    model.unstaged.push({ path, change: CHANGES[y] ?? "modified", code: xy, submodule });
}

/** @param {string} record @param {StatusModel} model */
function ordinary(record, model) {
  const match = ORDINARY.exec(record);
  if (match) place(match[1] ?? "", match[2] ?? "", match[3] ?? "", model);
}

/** @param {string} record @param {string} origPath @param {StatusModel} model */
function renamed(record, origPath, model) {
  const match = RENAMED.exec(record);
  if (match) place(match[1] ?? "", match[2] ?? "", match[4] ?? "", model, origPath);
}

/** @param {string} record @param {StatusModel} model */
function unmerged(record, model) {
  const match = UNMERGED.exec(record);
  if (!match) return;
  const code = match[1] ?? "UU";
  const submodule = (match[2] ?? "").startsWith("S");
  model.conflicts.push({ path: match[3] ?? "", change: "unmerged", code, submodule });
}

/** The words for an unmerged entry's XY code, as `git status` prints them. */
export function conflictLabel(/** @type {string} */ code) {
  switch (code) {
    case "DD":
      return "both deleted";
    case "AU":
      return "added by us";
    case "UD":
      return "deleted by them";
    case "UA":
      return "added by them";
    case "DU":
      return "deleted by us";
    case "AA":
      return "both added";
    default:
      return "both modified";
  }
}

/** The format `git stash list` is asked for: the ref, a unit separator, the subject. */
export const STASH_FORMAT = "%gd%x1f%gs";

/**
 * @param {string} text
 * @returns {Stash[]}
 */
export function parseStashes(text) {
  return lines(text).map((line) => {
    const sep = line.indexOf("\x1f");
    return sep < 0
      ? { ref: line, subject: "" }
      : { ref: line.slice(0, sep), subject: line.slice(sep + 1) };
  });
}

/** The format the recent commits are asked for: short sha, subject, decorations. */
export const RECENT_FORMAT = "%h%x1f%s%x1f%D";

/**
 * @param {string} text
 * @returns {RecentCommit[]}
 */
export function parseRecent(text) {
  return lines(text).map((line) => {
    const [sha = "", subject = "", decoration = ""] = line.split("\x1f");
    return { sha, subject, refs: decoration === "" ? [] : decoration.split(", ") };
  });
}

/** How many of each: "2 staged · 1 unstaged · 3 untracked", or "nothing to commit". */
export function summary(/** @type {StatusModel} */ model) {
  const parts = [
    [model.conflicts.length, "unmerged"],
    [model.staged.length, "staged"],
    [model.unstaged.length, "unstaged"],
    [model.untracked.length, "untracked"],
  ]
    .filter(([count]) => Number(count) > 0)
    .map(([count, word]) => `${count} ${word}`);
  return parts.length === 0 ? "nothing to commit, working tree clean" : parts.join(" · ");
}

const lines = (/** @type {string} */ text) => text.split("\n").filter((line) => line !== "");
