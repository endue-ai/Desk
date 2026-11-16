// What git prints, read into plain objects: refs (for-each-ref), the log's records, stashes,
// worktrees and the files a commit changes. No DOM and no bridge, so every parser is a unit test.

export const US = "\x1f";
export const RS = "\x1e";

/** The empty tree's id: what a root commit is compared with. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * @typedef {"head" | "remote" | "tag"} RefKind
 * @typedef {{ kind: RefKind, name: string, full: string, sha: string, upstream: string | null,
 *   ahead: number, behind: number, current: boolean, remote: string | null, date: number,
 *   subject: string, gone: boolean }} Ref
 * @typedef {{ sha: string, parents: string[], author: string, email: string, date: number,
 *   committer: string, committerDate: number, subject: string }} Commit
 * @typedef {{ index: number, name: string, sha: string, parents: string[], date: number, message: string }} Stash
 * @typedef {{ path: string, head: string | null, branch: string | null, bare: boolean,
 *   detached: boolean, locked: boolean, prunable: boolean }} Worktree
 * @typedef {{ path: string, origPath?: string, change: string, added: number | null, removed: number | null }} ChangedFile
 */

export const REF_FORMAT = [
  "%(refname)",
  "%(objectname)",
  "%(*objectname)",
  "%(upstream:short)",
  "%(upstream:track,nobracket)",
  "%(HEAD)",
  "%(creatordate:unix)",
  "%(contents:subject)",
].join("%1f");

/** `for-each-ref --format=REF_FORMAT refs/heads refs/remotes refs/tags`, one ref a line. */
export function parseRefs(/** @type {string} */ out) {
  /** @type {Ref[]} */
  const refs = [];
  for (const line of out.split("\n")) {
    if (line === "") continue;
    const [
      full = "",
      object = "",
      peeled = "",
      upstream = "",
      track = "",
      head = "",
      date = "",
      subject = "",
    ] = line.split(US);
    const kind = full.startsWith("refs/heads/")
      ? "head"
      : full.startsWith("refs/remotes/")
        ? "remote"
        : full.startsWith("refs/tags/")
          ? "tag"
          : null;
    if (kind === null) continue;
    const name = full.replace(/^refs\/(heads|remotes|tags)\//, "");
    if (kind === "remote" && name.endsWith("/HEAD")) continue;
    const { ahead, behind, gone } = parseTrack(track);
    refs.push({
      kind,
      name,
      full,
      sha: peeled || object,
      upstream: upstream || null,
      ahead,
      behind,
      gone,
      current: head === "*",
      remote: kind === "remote" ? (name.split("/")[0] ?? null) : null,
      date: Number(date) || 0,
      subject,
    });
  }
  return refs;
}

/** `ahead 2, behind 1`, `gone` or nothing. */
export function parseTrack(/** @type {string} */ track) {
  const ahead = Number(/ahead (\d+)/.exec(track)?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(track)?.[1] ?? 0);
  return { ahead, behind, gone: track.includes("gone") };
}

export const LOG_FORMAT = `${["%H", "%P", "%an", "%ae", "%at", "%cn", "%ct", "%s"].join("%x1f")}%x1e`;

/** `log --format=LOG_FORMAT`: records split by RS, fields by US. */
export function parseLog(/** @type {string} */ out) {
  /** @type {Commit[]} */
  const commits = [];
  for (const record of out.split(RS)) {
    const trimmed = record.replace(/^\n/, "");
    if (trimmed === "") continue;
    const [
      sha = "",
      parents = "",
      author = "",
      email = "",
      date = "",
      committer = "",
      cdate = "",
      ...rest
    ] = trimmed.split(US);
    if (!/^[0-9a-f]{7,64}$/.test(sha)) continue;
    commits.push({
      sha,
      parents: parents === "" ? [] : parents.split(" "),
      author,
      email,
      date: Number(date) || 0,
      committer,
      committerDate: Number(cdate) || 0,
      subject: rest.join(US),
    });
  }
  return commits;
}

export const STASH_FORMAT = ["%gd", "%H", "%P", "%ct", "%gs"].join("%x1f");

/** `stash list --format=STASH_FORMAT`. */
export function parseStashes(/** @type {string} */ out) {
  /** @type {Stash[]} */
  const stashes = [];
  for (const line of out.split("\n")) {
    if (line === "") continue;
    const [name = "", sha = "", parents = "", date = "", message = ""] = line.split(US);
    const index = Number(/\{(\d+)\}/.exec(name)?.[1] ?? stashes.length);
    stashes.push({
      index,
      name,
      sha,
      parents: parents === "" ? [] : parents.split(" "),
      date: Number(date) || 0,
      message: message.replace(/^(WIP on|On) [^:]+: /, ""),
    });
  }
  return stashes;
}

/** `worktree list --porcelain`: blocks split by a blank line. */
export function parseWorktrees(/** @type {string} */ out) {
  /** @type {Worktree[]} */
  const trees = [];
  for (const block of out.split("\n\n")) {
    if (block.trim() === "") continue;
    /** @type {Worktree} */
    const tree = {
      path: "",
      head: null,
      branch: null,
      bare: false,
      detached: false,
      locked: false,
      prunable: false,
    };
    for (const line of block.split("\n")) {
      const [key = "", ...rest] = line.split(" ");
      const value = rest.join(" ");
      if (key === "worktree") tree.path = value;
      else if (key === "HEAD") tree.head = value;
      else if (key === "branch") tree.branch = value.replace(/^refs\/heads\//, "");
      else if (key === "bare") tree.bare = true;
      else if (key === "detached") tree.detached = true;
      else if (key === "locked") tree.locked = true;
      else if (key === "prunable") tree.prunable = true;
    }
    if (tree.path) trees.push(tree);
  }
  return trees;
}

/**
 * `diff --name-status -z -M` and `diff --numstat -z -M` of the same range, merged by path.
 * @param {string} names
 * @param {string} numbers
 */
export function parseChangedFiles(names, numbers) {
  /** @type {ChangedFile[]} */
  const files = [];
  const fields = names.split("\0");
  for (let i = 0; i < fields.length; ) {
    const status = fields[i++] ?? "";
    if (status === "") continue;
    const change = status[0] ?? "M";
    if (change === "R" || change === "C") {
      const origPath = fields[i++] ?? "";
      const path = fields[i++] ?? "";
      files.push({ path, origPath, change, added: null, removed: null });
    } else {
      files.push({ path: fields[i++] ?? "", change, added: null, removed: null });
    }
  }
  const counts = parseNumstat(numbers);
  for (const file of files) {
    const count = counts.get(file.path);
    if (count) Object.assign(file, count);
  }
  return files;
}

/** `--numstat -z`: `added\tremoved\tpath\0`, or for a rename `added\tremoved\t\0old\0new\0`. */
export function parseNumstat(/** @type {string} */ out) {
  /** @type {Map<string, { added: number | null, removed: number | null }>} */
  const counts = new Map();
  const fields = out.split("\0");
  for (let i = 0; i < fields.length; ) {
    const head = fields[i++] ?? "";
    if (head === "") continue;
    const [added = "", removed = "", path = ""] = head.split("\t");
    const value = {
      added: added === "-" ? null : Number(added),
      removed: removed === "-" ? null : Number(removed),
    };
    if (path === "") {
      i++;
      counts.set(fields[i++] ?? "", value);
    } else counts.set(path, value);
  }
  return counts;
}

/** `show -s --format=%B` and friends: the summary line and the body after it. */
export function splitMessage(/** @type {string} */ message) {
  const text = message.replace(/\s+$/, "");
  const at = text.indexOf("\n");
  if (at < 0) return { summary: text, body: "" };
  return { summary: text.slice(0, at), body: text.slice(at + 1).replace(/^\n+/, "") };
}
