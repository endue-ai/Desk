// A file's past and a search through every commit: the commits that touched a path (following
// renames), who last changed each line (blame --porcelain), and the commits whose changes hold
// some text (the pickaxe) or touched a path like a pattern.

import { LOG_FORMAT, parseLog } from "./parse.js";

/**
 * @typedef {import("./repo.js").Runner} Runner
 * @typedef {import("./parse.js").Commit & { path: string, origPath?: string, change: string }} FileCommit
 * @typedef {{ sha: string, author: string, email: string, time: number, summary: string, filename: string,
 *   previous: string | null, boundary: boolean }} BlameCommit
 * @typedef {{ line: number, text: string, sha: string }} BlameLine
 */

const SCOPE = ["--branches", "--remotes", "--tags", "HEAD"];

/** The commits that changed `path`, newest first, each with the path it had then. */
export async function fileHistory(
  /** @type {Runner} */ git,
  /** @type {string} */ root,
  /** @type {string} */ path,
  limit = 300,
) {
  const { stdout } = await git.run(
    [
      "--literal-pathspecs",
      "log",
      "--follow",
      "-M",
      `-n${limit}`,
      `--format=${LOG_FORMAT}`,
      "--name-status",
      "-z",
      "HEAD",
      "--",
      path,
    ],
    { cwd: root },
  );
  return parseFileLog(stdout);
}

/**
 * `log --format=LOG_FORMAT --name-status -z`: a record ends with RS, then come its status fields
 * (`\0\nM\0path\0` or `\0\nR100\0old\0new\0`) and right after them the next record's fields.
 */
export function parseFileLog(/** @type {string} */ out) {
  /** @type {FileCommit[]} */
  const commits = [];
  /** @type {import("./parse.js").Commit | null} */
  let pending = null;
  for (const chunk of out.split("\x1e")) {
    const tokens = chunk.replace(/^\0?\n?/, "").split("\0");
    let header = chunk;
    if (pending) {
      const status = tokens[0] ?? "";
      const change = /^[A-Z]\d*$/.test(status) ? (status[0] ?? "M") : "M";
      const renamed = change === "R" || change === "C";
      const used = /^[A-Z]\d*$/.test(status) ? (renamed ? 3 : 2) : 0;
      commits.push({
        ...pending,
        change,
        path: (renamed ? tokens[2] : tokens[1]) ?? "",
        ...(renamed ? { origPath: tokens[1] ?? "" } : {}),
      });
      header = tokens.slice(used).join("\0");
    }
    pending = parseLog(`${header.replace(/^[\0\n]+/, "")}\x1e`)[0] ?? null;
  }
  return commits;
}
/** Who last changed each line of `path` (in the working copy, or at `rev`). */
export async function blame(
  /** @type {Runner} */ git,
  /** @type {string} */ root,
  /** @type {string} */ path,
  /** @type {string | null} */ rev = null,
) {
  const { stdout } = await git.run(
    ["blame", "--porcelain", "--no-textconv", ...(rev ? [rev] : []), "--", path],
    {
      cwd: root,
    },
  );
  return parseBlame(stdout);
}

/** `blame --porcelain`: a header per line, the commit's fields the first time it appears. */
export function parseBlame(/** @type {string} */ out) {
  /** @type {Map<string, BlameCommit>} */
  const commits = new Map();
  /** @type {BlameLine[]} */
  const lines = [];
  /** @type {BlameCommit | null} */
  let current = null;
  let finalLine = 0;
  for (const raw of out.split("\n")) {
    if (raw.startsWith("\t")) {
      if (current) lines.push({ line: finalLine, text: raw.slice(1), sha: current.sha });
      continue;
    }
    const header = /^([0-9a-f]{40,64}) \d+ (\d+)/.exec(raw);
    if (header) {
      const sha = header[1] ?? "";
      finalLine = Number(header[2]);
      current = commits.get(sha) ?? {
        sha,
        author: "",
        email: "",
        time: 0,
        summary: "",
        filename: "",
        previous: null,
        boundary: false,
      };
      commits.set(sha, current);
      continue;
    }
    if (!current) continue;
    const at = raw.indexOf(" ");
    const key = at < 0 ? raw : raw.slice(0, at);
    const value = at < 0 ? "" : raw.slice(at + 1);
    if (key === "author") current.author = value;
    else if (key === "author-mail") current.email = value.replace(/^<|>$/g, "");
    else if (key === "author-time") current.time = Number(value);
    else if (key === "summary") current.summary = value;
    else if (key === "filename") current.filename = value;
    else if (key === "previous") current.previous = value.split(" ")[0] ?? null;
    else if (key === "boundary") current.boundary = true;
  }
  return { commits, lines };
}

/**
 * The ids of the commits that match a deep search: `code` finds commits whose changes add or
 * remove the text (git log -S), `path` those that touched a path holding the words.
 * @param {Runner} git @param {string} root @param {"code" | "path"} mode @param {string} text
 */
export async function deepSearch(git, root, mode, text, limit = 1000) {
  const args =
    mode === "code"
      ? ["log", ...SCOPE, `-n${limit}`, "--format=%H", `-S${text}`, "--"]
      : [
          "log",
          ...SCOPE,
          `-n${limit}`,
          "--format=%H",
          "--",
          `:(icase,glob)**/*${text.replace(/[*?[\]]/g, "")}*`,
        ];
  const { stdout } = await git.run(args, { cwd: root, timeoutMs: 60_000 });
  return new Set(stdout.split("\n").filter(Boolean));
}

/**
 * Commits as data, newest first, from every branch, remote branch and tag: those whose message
 * holds `query` (any case, as plain text), whose changes add or remove it (`code`) or that touched
 * a path holding it (`path`); all of them without a query. `author` narrows by name or email.
 * One more than `limit` is read, so `more` says whether git had more to give.
 * @param {Runner} git @param {string} root
 * @param {{ query?: string, mode?: "text" | "code" | "path", author?: string, limit?: number }} [find]
 */
export async function findCommits(git, root, find = {}) {
  const { query = "", mode = "text", author = "", limit = 50 } = find;
  const args = ["log", ...SCOPE, `-n${limit + 1}`, `--format=${LOG_FORMAT}`, "-i", "-F"];
  if (author) args.push(`--author=${author}`);
  if (query && mode === "text") args.push(`--grep=${query}`);
  if (query && mode === "code") args.push(`-S${query}`);
  args.push("--");
  if (query && mode === "path") args.push(`:(icase,glob)**/*${query.replace(/[*?[\]]/g, "")}*`);
  const { stdout } = await git.run(args, { cwd: root, timeoutMs: 60_000 });
  const commits = parseLog(stdout);
  return { commits: commits.slice(0, limit), more: commits.length > limit };
}
