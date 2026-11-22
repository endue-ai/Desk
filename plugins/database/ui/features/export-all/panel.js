// The panel of a whole export (jobs.js): its title and status with Cancel while it runs, a line per
// file with its rows and bytes as they grow and its status, and the end's sentence. A new state is
// drawn in place. Layout: export-all.css.

import { sizeText } from "../../console-files.js";
import { el } from "../../dom.js";
import { formatCount } from "../../format.js";

/**
 * @typedef {import("./jobs.js").JobState} JobState
 * @typedef {import("./jobs.js").FileState} FileState
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const STATUS = {
  waiting: "Waiting",
  running: "Running",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};
const TONES = {
  waiting: "",
  running: "info",
  done: "success",
  failed: "danger",
  cancelled: "warning",
};

/** A file's rows and bytes: `1,250,000 rows · 48.2 MiB`. */
export function countOf(/** @type {Pick<FileState, "rows" | "bytes">} */ f) {
  const bytes = f.bytes === 0 ? "0 KiB" : sizeText(f.bytes);
  return `${formatCount(f.rows)} row${f.rows === 1 ? "" : "s"} · ${bytes}`;
}

/**
 * @param {Document} doc
 * @param {JobState} first
 * @param {Act} act
 * @param {{ id: string }} buffer
 */
export function exportAllPanel(doc, first, act, buffer) {
  const title = el(doc, "h2", { class: "export-all-title" });
  const dot = el(doc, "span", { class: "desk-dot", "aria-hidden": "true" });
  const status = el(doc, "span", { class: "export-all-status", role: "status" });
  const cancel = el(
    doc,
    "button",
    { type: "button", class: "desk-btn desk-btn-quiet", "data-ctl": "cancel" },
    "Cancel",
  );
  cancel.addEventListener("click", () => act("exportAllCancel", buffer.id));
  const result = el(doc, "p", { class: "desk-callout export-all-result", "data-part": "result" });
  const list = el(doc, "ul", { class: "export-all-files", "data-part": "files" });
  const root = el(
    doc,
    "section",
    { class: "export-all" },
    el(doc, "header", { class: "export-all-head" }, title, dot, status, cancel),
    result,
    list,
  );
  const update = (/** @type {JobState} */ s) => {
    title.textContent = s.title;
    dot.dataset.tone = TONES[s.status];
    const rows = s.files.reduce((n, f) => n + f.rows, 0);
    const bytes = s.files.reduce((n, f) => n + f.bytes, 0);
    status.textContent = `${STATUS[s.status]} · ${countOf({ rows, bytes })}`;
    cancel.hidden = s.status !== "running";
    result.textContent = s.result;
    result.hidden = s.result === "";
    result.dataset.tone =
      s.status === "failed" ? "danger" : s.status === "cancelled" ? "warning" : "";
    list.replaceChildren(
      ...s.files.map((f) =>
        el(
          doc,
          "li",
          { class: "export-all-file", "data-status": f.status },
          el(doc, "span", { class: "export-all-name" }, f.path || f.name),
          el(doc, "span", { class: "export-all-count" }, countOf(f)),
          el(doc, "span", { class: "desk-badge", "data-tone": TONES[f.status] }, STATUS[f.status]),
        ),
      ),
    );
  };
  update(first);
  return { el: root, update, destroy() {} };
}
