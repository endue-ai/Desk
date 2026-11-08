// The diff view's rows: a heading per file and per hunk (both foldable) and the lines with their
// old and new numbers. Lines are items too, so `s` on one stages its file.

import { el, row, span } from "./dom.js";
import { stats } from "./parse-diff.js";

/**
 * @typedef {import("./git.js").DiffView} DiffView
 * @typedef {import("./dom.js").RowSpec} RowSpec
 */

/**
 * @param {Document} doc
 * @param {DiffView} model
 * @param {Set<string>} folded
 * @returns {RowSpec[]}
 */
export function renderDiff(doc, model, folded) {
  /** @type {RowSpec[]} */
  const rows = [];
  const section = model.target.staged ? "staged" : "unstaged";
  const total = stats(model.files);
  rows.push(
    row(doc, "head", undefined, 1, [
      span(doc, "label", "Diff:"),
      span(doc, "branch", model.title),
      span(
        doc,
        "counts",
        `${total.files} file${total.files === 1 ? "" : "s"}, +${total.additions} −${total.deletions}`,
      ),
    ]),
  );
  if (model.files.length === 0) rows.push(row(doc, "empty", undefined, 1, ["No changes."]));
  for (const file of model.files) {
    const key = `file:${file.path}`;
    const open = !folded.has(key);
    const name =
      file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path;
    rows.push(
      row(
        doc,
        `file ${file.status}`,
        { kind: "file", section, path: file.path },
        1,
        [
          span(doc, "caret", open ? "▾" : "▸"),
          span(doc, "path", name),
          span(doc, "detail", file.binary ? "binary" : file.status),
        ],
        key,
      ),
    );
    if (!open) continue;
    file.hunks.forEach((hunk, index) => {
      const hunkKey = `hunk:${file.path}:${index}`;
      const hunkOpen = !folded.has(hunkKey);
      rows.push(
        row(
          doc,
          "hunk",
          { kind: "hunk", path: file.path, index },
          2,
          [
            span(doc, "caret", hunkOpen ? "▾" : "▸"),
            span(doc, "header", hunk.header.replace(/ @@.*$/, " @@")),
            span(doc, "heading", hunk.heading),
          ],
          hunkKey,
        ),
      );
      if (!hunkOpen) return;
      for (const line of hunk.lines) {
        rows.push(
          row(doc, `line ${line.kind}`, { kind: "line", path: file.path, index }, 3, [
            span(doc, "no", line.oldNo === null ? "" : String(line.oldNo)),
            span(doc, "no", line.newNo === null ? "" : String(line.newNo)),
            el(
              doc,
              "span",
              { class: "text" },
              line.kind === "note" ? `\\ ${line.text}` : line.text,
            ),
          ]),
        );
      }
    });
  }
  return rows;
}
