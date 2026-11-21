// The log panel of a backup or a restore (job.js): what runs and its status sentence, Cancel while
// it runs, how far it got, the exact command line and where the password comes from, the result
// once it ended, and the program's lines as they came, the newest at the bottom (followed while
// the person has not scrolled up). A new state is drawn in place. Layout: backup.css.

import { el } from "../../dom.js";
import { formatCount } from "../../format.js";

/**
 * @typedef {import("./job.js").LogState} LogState
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const STATUS = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};
const TONES = { running: "info", done: "success", failed: "danger", cancelled: "warning" };

const ONE = /** @type {Record<string, string>} */ ({ tables: "table", entries: "entry" });

/** How far it got: `12 of 40 entries`, `3 tables`, `1 table`. */
export function progressOf(/** @type {LogState} */ s) {
  const done = formatCount(s.done);
  const of = s.total === null ? "" : ` of ${formatCount(s.total)}`;
  const noun = (s.total ?? s.done) === 1 ? (ONE[s.noun] ?? s.noun) : s.noun;
  return `${done}${of} ${noun}`;
}

/**
 * @param {Document} doc
 * @param {LogState} first
 * @param {Act} act
 * @param {{ id: string }} buffer
 */
export function logPanel(doc, first, act, buffer) {
  const title = el(doc, "h2", { class: "backup-title" });
  const dot = el(doc, "span", { class: "desk-dot", "aria-hidden": "true" });
  const status = el(doc, "span", { class: "backup-status", role: "status" });
  const cancel = el(
    doc,
    "button",
    { type: "button", class: "desk-btn desk-btn-quiet", "data-ctl": "cancel" },
    "Cancel",
  );
  cancel.addEventListener("click", () => act("backupCancel", buffer.id));
  const command = el(doc, "pre", { class: "backup-command", "data-part": "command" });
  const password = el(doc, "p", { class: "hint" });
  const result = el(doc, "p", { class: "desk-callout backup-result", "data-part": "result" });
  const log = el(doc, "pre", {
    class: "backup-lines",
    "data-part": "log",
    tabindex: "0",
    "aria-label": "Output",
  });
  const root = el(
    doc,
    "section",
    { class: "backup-log" },
    el(doc, "header", { class: "backup-head" }, title, dot, status, cancel),
    command,
    password,
    result,
    log,
  );

  const update = (/** @type {LogState} */ s) => {
    const following = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
    title.textContent = s.title;
    dot.dataset.tone = TONES[s.status];
    status.textContent = `${STATUS[s.status]} · ${progressOf(s)}`;
    cancel.hidden = s.status !== "running";
    command.textContent = s.command;
    password.textContent = s.password;
    result.textContent = s.result;
    result.hidden = s.result === "";
    result.dataset.tone =
      s.status === "failed" ? "danger" : s.status === "cancelled" ? "warning" : "";
    if (s.status === "failed") result.setAttribute("role", "alert");
    else result.removeAttribute("role");
    const head = s.dropped ? [`… ${formatCount(s.dropped)} earlier lines not kept`] : [];
    log.textContent = [...head, ...s.lines].join("\n");
    if (following) log.scrollTop = log.scrollHeight;
  };
  update(first);
  return { el: root, update };
}
