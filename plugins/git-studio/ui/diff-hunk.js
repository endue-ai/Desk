// One hunk of the diff viewer: its bar (the range, the enclosing function, and Stage, Unstage or
// Discard for the hunk or the picked lines) and its lines, unified or side by side.

import { spans, syntax, wordDiff } from "./diff-text.js";
import { h, icon } from "./dom.js";
import { hunkPatch, pairLines } from "./parse-diff.js";

/**
 * @typedef {import("./parse-diff.js").DiffFile} DiffFile
 * @typedef {import("./parse-diff.js").Hunk} Hunk
 * @typedef {import("./parse-diff.js").Line} Line
 * @typedef {"stage" | "unstage" | "discard"} PatchOp
 * @typedef {{ diff: DiffFile, hunk: Hunk, mode: "unified" | "split", kind: "unstaged" | "staged" | "commit",
 *   picked: Set<number>, onToggle(line: number): void, onClear(): void,
 *   onAct(op: PatchOp, patch: string, what: string): void }} HunkSpec
 */

/** @param {HunkSpec} spec */
export function drawHunk({ diff, hunk, mode, kind, picked, onToggle, onClear, onAct }) {
  const wip = kind !== "commit";
  const staged = kind === "staged";
  const words = wordsOf(hunk);
  const path = diff.path;
  const what = picked.size ? `${picked.size} line${picked.size === 1 ? "" : "s"}` : "hunk";
  const act = (/** @type {PatchOp} */ op) => {
    const text = hunkPatch(diff, hunk, picked.size ? picked : null, { reverse: op !== "stage" });
    if (text) onAct(op, text, what);
  };
  const toggle = (/** @type {number} */ i) => {
    const line = hunk.lines[i];
    if (wip && line && line.kind !== " " && line.kind !== "\\") onToggle(i);
  };
  const bar = h(
    "div.hunk-bar",
    null,
    h(
      "span.hunk-range",
      null,
      `@@ −${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines}`,
    ),
    h("span.hunk-section", null, hunk.section),
    h("span.desk-bar-spacer"),
    wip && picked.size
      ? h("button.desk-btn.desk-btn-quiet.mini", { type: "button", onClick: onClear }, "Clear")
      : null,
    wip && !staged
      ? h(
          "button.desk-btn.desk-btn-quiet.mini",
          { type: "button", onClick: () => act("discard") },
          icon("trash", 12),
          `Discard ${what}`,
        )
      : null,
    wip
      ? h(
          "button.desk-btn.mini",
          { type: "button", onClick: () => act(staged ? "unstage" : "stage") },
          icon(staged ? "minus" : "plus", 12),
          `${staged ? "Unstage" : "Stage"} ${what}`,
        )
      : null,
  );
  const text = (/** @type {Line} */ line, /** @type {number} */ i) =>
    spans(document, line.text, syntax(line.text, path), words.get(i) ?? []);
  const kindOf = (/** @type {Line} */ line) =>
    line.kind === "+" ? "is-add" : line.kind === "-" ? "is-del" : "is-ctx";
  const rows = [];
  if (mode === "unified") {
    for (const [i, line] of hunk.lines.entries()) {
      if (line.kind === "\\") {
        rows.push(
          h(
            "div.dl.is-note",
            null,
            h("span.ln"),
            h("span.ln"),
            h("span.sign"),
            h("span.code", null, line.text.trim()),
          ),
        );
        continue;
      }
      rows.push(
        h(
          "div.dl",
          {
            class: `${kindOf(line)}${picked.has(i) ? " is-picked" : ""}`,
            onClick: (/** @type {MouseEvent} */ e) => {
              if (/** @type {HTMLElement} */ (e.target).closest(".ln, .sign")) toggle(i);
            },
          },
          h(
            "span.ln",
            { title: wip && line.kind !== " " ? "Pick this line" : undefined },
            line.old ?? "",
          ),
          h("span.ln", null, line.new ?? ""),
          h("span.sign", null, line.kind === " " ? "" : line.kind),
          h("span.code", null, text(line, i)),
        ),
      );
    }
  } else {
    for (const row of pairLines(hunk)) {
      const side = (
        /** @type {(Line & { index: number }) | null} */ line,
        /** @type {"old" | "new"} */ which,
      ) => {
        if (!line) return [h("span.ln.is-blank"), h("span.code.is-blank")];
        const cls = `${kindOf(line)}${picked.has(line.index) ? " is-picked" : ""}`;
        return [
          h(
            "span.ln",
            { class: cls, onClick: () => toggle(line.index) },
            which === "old" ? (line.old ?? "") : (line.new ?? ""),
          ),
          h("span.code", { class: cls }, text(line, line.index)),
        ];
      };
      rows.push(h("div.dl.is-pair", null, ...side(row.left, "old"), ...side(row.right, "new")));
    }
  }
  return h("section.hunk", null, bar, h("div.hunk-lines", null, ...rows));
}

/** Changed words of each removed line against the added line beside it. @param {Hunk} hunk */
export function wordsOf(hunk) {
  /** @type {Map<number, import("./diff-text.js").Range[]>} */
  const out = new Map();
  for (const { left, right } of pairLines(hunk)) {
    if (!left || !right || left === right || left.kind !== "-" || right.kind !== "+") continue;
    const diff = wordDiff(left.text, right.text);
    out.set(left.index, diff.before);
    out.set(right.index, diff.after);
  }
  return out;
}
