// The status view's rows, one status buffer: the head, then the unmerged, staged, unstaged
// and untracked files, the stashes and the recent commits, each section foldable.

import { el, row, span } from "./dom.js";
import { conflictLabel } from "./parse-status.js";

/**
 * @typedef {import("./git.js").StatusView} StatusView
 * @typedef {import("./parse-status.js").Entry} Entry
 * @typedef {import("./dom.js").RowSpec} RowSpec
 */

/** @type {Record<string, string>} */
const LETTERS = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  typechange: "T",
  unmerged: "U",
};

/**
 * @param {Document} doc
 * @param {StatusView} model
 * @param {Set<string>} folded Section keys that show only their heading.
 * @returns {RowSpec[]}
 */
export function renderStatus(doc, model, folded) {
  const { status, stashes, recent } = model;
  /** @type {RowSpec[]} */
  const rows = [];
  const { head } = status;
  rows.push(
    row(doc, "head", undefined, 1, [
      span(doc, "label", "Head:"),
      span(doc, "branch", head.branch ?? (head.oid ? `detached at ${head.oid.slice(0, 7)}` : "")),
      span(doc, "subject", recent[0]?.subject ?? (head.oid === null ? "no commits yet" : "")),
    ]),
  );
  if (head.upstream) {
    const counts = [head.ahead ? `↑${head.ahead}` : "", head.behind ? `↓${head.behind}` : ""];
    rows.push(
      row(doc, "head", undefined, 1, [
        span(doc, "label", "Upstream:"),
        span(doc, "branch", head.upstream),
        span(doc, "counts", counts.filter(Boolean).join(" ") || "up to date"),
      ]),
    );
  }

  /**
   * @param {string} key
   * @param {string} title
   * @param {RowSpec[]} children
   */
  const section = (key, title, children) => {
    if (children.length === 0) return;
    const open = !folded.has(key);
    rows.push(
      row(
        doc,
        "section",
        { kind: "section", section: key },
        1,
        [
          span(doc, "caret", open ? "▾" : "▸"),
          span(doc, "title", title),
          span(doc, "count", `(${children.length})`),
        ],
        key,
      ),
    );
    if (open) rows.push(...children);
  };

  /** @param {"staged" | "unstaged" | "conflicts"} key @param {Entry} entry */
  const file = (key, entry) =>
    row(doc, `file ${entry.change}`, { kind: "file", section: key, path: entry.path }, 2, [
      span(doc, "change", LETTERS[entry.change] ?? "M"),
      span(doc, "path", entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path),
      entry.change === "unmerged" ? span(doc, "detail", conflictLabel(entry.code)) : undefined,
      entry.submodule ? span(doc, "detail", "submodule") : undefined,
    ]);

  section(
    "conflicts",
    "Unmerged",
    status.conflicts.map((entry) => file("conflicts", entry)),
  );
  section(
    "untracked",
    "Untracked files",
    status.untracked.map((path) =>
      row(doc, "file untracked", { kind: "file", section: "untracked", path }, 2, [
        span(doc, "change", "?"),
        span(doc, "path", path),
      ]),
    ),
  );
  section(
    "unstaged",
    "Unstaged changes",
    status.unstaged.map((entry) => file("unstaged", entry)),
  );
  section(
    "staged",
    "Staged changes",
    status.staged.map((entry) => file("staged", entry)),
  );
  section(
    "stashes",
    "Stashes",
    stashes.map((stash) =>
      row(doc, "stash", { kind: "stash", ref: stash.ref }, 2, [
        span(doc, "sha", stash.ref),
        span(doc, "subject", stash.subject),
      ]),
    ),
  );
  section(
    "recent",
    "Recent commits",
    recent.map((commit) =>
      row(doc, "commit", { kind: "commit", sha: commit.sha }, 2, [
        span(doc, "sha", commit.sha),
        el(
          doc,
          "span",
          { class: "refs" },
          ...commit.refs.map((ref) => span(doc, "ref", ref.replace(/^HEAD -> /, ""))),
        ),
        span(doc, "subject", commit.subject),
      ]),
    ),
  );
  return rows;
}
