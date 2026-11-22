// The copy's panel (PG-63): where from and where to, the status sentence with Start and Cancel,
// what holds the copy and what to know before it runs, an append's column mapping, each table's
// bytes and rows as they go, the result, and the script the target's side runs. A new state is
// drawn in place. Layout: transfer.css.

import { el } from "../dom.js";
import { formatBytes, formatCount } from "../format.js";

/**
 * @typedef {import("./state.js").TransferState} TransferState
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const STATUS = {
  checking: "Reading both sides",
  ready: "Ready to copy",
  held: "Held",
  running: "Copying",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};
const TONES = {
  checking: "info",
  ready: "info",
  held: "warning",
  running: "info",
  done: "success",
  failed: "danger",
  cancelled: "warning",
};

/** A table's line: `public.items → public.items · 2 MiB · 1,000 rows`. */
export function stepLine(/** @type {TransferState["steps"][number]} */ step) {
  const moved = step.state === "waiting" ? "waiting" : formatBytes(step.bytes);
  const rows = step.rows === null ? "" : ` · ${formatCount(step.rows)} rows`;
  return `${step.source} → ${step.target} · ${moved}${rows}`;
}

/**
 * @param {Document} doc
 * @param {TransferState} first
 * @param {Act} act
 * @param {{ id: string }} buffer
 */
export function transferPanel(doc, first, act, buffer) {
  const title = el(doc, "h2", { class: "transfer-title" });
  const dot = el(doc, "span", { class: "desk-dot", "aria-hidden": "true" });
  const status = el(doc, "span", { class: "transfer-status", role: "status" });
  const startButton = /** @type {HTMLButtonElement} */ (
    el(
      doc,
      "button",
      { type: "button", class: "desk-btn desk-btn-primary", "data-ctl": "start" },
      "Start the copy",
    )
  );
  startButton.addEventListener("click", () => act("transferStart", buffer.id));
  const cancel = el(
    doc,
    "button",
    { type: "button", class: "desk-btn desk-btn-quiet", "data-ctl": "cancel" },
    "Cancel",
  );
  cancel.addEventListener("click", () => act("transferCancel", buffer.id));
  const route = el(doc, "p", { class: "hint" });
  const problems = el(doc, "ul", {
    class: "desk-callout transfer-list",
    "data-tone": "danger",
    "data-part": "problems",
  });
  const notes = el(doc, "ul", { class: "transfer-list transfer-notes", "data-part": "notes" });
  const mapping = el(doc, "div", { class: "transfer-mapping", "data-part": "mapping" });
  const steps = el(doc, "ul", { class: "desk-list transfer-steps", "data-part": "steps" });
  const result = el(doc, "p", { class: "desk-callout transfer-result", "data-part": "result" });
  const script = el(doc, "pre", {
    class: "transfer-script",
    "data-part": "script",
    tabindex: "0",
    "aria-label": "The target's script",
  });
  const root = el(
    doc,
    "section",
    { class: "transfer-panel" },
    el(doc, "header", { class: "transfer-head" }, title, dot, status, startButton, cancel),
    route,
    problems,
    notes,
    mapping,
    steps,
    result,
    script,
  );
  /** The mapping's selects, redrawn only when its rows change. */
  let drawn = "";

  const items = (/** @type {HTMLElement} */ list, /** @type {string[]} */ lines) => {
    list.replaceChildren(...lines.map((line) => el(doc, "li", {}, line)));
    list.hidden = lines.length === 0;
  };
  const drawMapping = (/** @type {TransferState} */ s) => {
    const key = JSON.stringify(s.mapping) + s.status;
    if (key === drawn) return;
    drawn = key;
    mapping.hidden = !s.mapping;
    const rows = (s.mapping ?? []).map((row) => {
      const select = /** @type {HTMLSelectElement} */ (
        el(
          doc,
          "select",
          { class: "desk-field", "aria-label": `Target column for ${row.source}` },
          el(doc, "option", { value: "" }, "Leave out"),
          ...row.choices.map((c) => el(doc, "option", { value: c }, c)),
        )
      );
      select.value = row.target;
      select.disabled = s.status === "running";
      select.addEventListener("change", () =>
        act("transferMap", buffer.id, row.source, select.value),
      );
      return el(
        doc,
        "label",
        { class: "transfer-pair-row" },
        el(doc, "span", {}, row.source),
        select,
      );
    });
    mapping.replaceChildren(
      el(doc, "p", { class: "hint" }, "Each result column goes into"),
      ...rows,
    );
  };

  const update = (/** @type {TransferState} */ s) => {
    title.textContent = s.title;
    dot.dataset.tone = TONES[s.status];
    status.textContent = STATUS[s.status];
    startButton.hidden = s.status !== "ready";
    cancel.hidden = s.status !== "running";
    route.textContent = `From ${s.from} into ${s.to}`;
    items(problems, s.problems);
    items(notes, s.notes);
    drawMapping(s);
    steps.replaceChildren(
      ...s.steps.map((step) =>
        el(
          doc,
          "li",
          { class: "desk-list-row", "data-state": step.state },
          el(doc, "span", { class: "desk-list-text" }, stepLine(step)),
        ),
      ),
    );
    steps.hidden = s.steps.length === 0;
    result.textContent = s.result;
    result.hidden = s.result === "";
    result.dataset.tone =
      s.status === "failed" ? "danger" : s.status === "cancelled" ? "warning" : "";
    if (s.status === "failed") result.setAttribute("role", "alert");
    else result.removeAttribute("role");
    script.textContent = s.script;
    script.hidden = s.script === "";
  };
  update(first);
  return { el: root, update };
}
