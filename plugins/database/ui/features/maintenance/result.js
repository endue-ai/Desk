// A maintenance form's run (panel.js draws it below the form): while it goes on, how long it has
// run, the phase and blocks from the server's progress views as a bar, and the lock it waits for
// and who holds it; when it ends, how it ended in a sentence (the server's words on a failure),
// the server's output (VERBOSE and notices, which today's runner hands over at the end), and the
// statistics before and after, the rows that changed marked.

import { el } from "../../dom.js";
import { formatDuration } from "../../format.js";
import { compared } from "./model.js";

/** @typedef {import("./controller.js").MaintenanceState} MaintenanceState */

/** The run's progress in a sentence, and its bar's value and maximum when known. */
export function progressLine(/** @type {MaintenanceState} */ s, now = Date.now()) {
  const run = s.run;
  if (!run) return { text: "", value: null, max: null, wait: "" };
  const ms = run.progress?.ms ?? Math.max(0, now - run.started);
  const p = run.progress;
  const parts = [`Running for ${formatDuration(ms)}`];
  if (p?.command) parts.push(p.command);
  if (p?.phase) parts.push(p.phase);
  if (p?.total)
    parts.push(
      `${(p.done ?? 0).toLocaleString("en-US")} of ${p.total.toLocaleString("en-US")} blocks (${Math.floor(((p.done ?? 0) * 100) / p.total)}%)`,
    );
  if (p?.relation) parts.push(p.relation);
  if (!p) parts.push(run.reads ? "its session is not in the progress views yet" : "starting");
  const held = p?.blockedBy.length ? ` held by session ${p.blockedBy.join(", ")}` : "";
  const wait = p?.wait ? `Waiting for a lock (${p.wait})${held}.` : "";
  return {
    text: `${parts.join(" · ")}.`,
    value: p?.total ? (p.done ?? 0) : null,
    max: p?.total ?? null,
    wait,
  };
}

/** How a run ended, in one sentence. */
function endedOf(/** @type {NonNullable<MaintenanceState["run"]>} */ run) {
  if (run.status === "done") return `Done in ${formatDuration(run.ms)}.`;
  if (run.status === "cancelled") return `Cancelled after ${formatDuration(run.ms)}.`;
  return `Failed after ${formatDuration(run.ms)}.`;
}

/** The run's section: its progress while it goes on, else its end, output and statistics. */
export function runSection(/** @type {Document} */ doc, /** @type {MaintenanceState} */ s) {
  const run = /** @type {NonNullable<MaintenanceState["run"]>} */ (s.run);
  const section = el(doc, "section", {
    class: "maint-run",
    "data-part": "run",
    "aria-label": "Run",
  });
  if (run.status === "running") {
    const line = progressLine(s);
    const bar = /** @type {HTMLProgressElement} */ (
      el(doc, "progress", { class: "desk-progress maint-bar", "aria-label": "Progress" })
    );
    if (line.max !== null && line.value !== null) {
      bar.max = line.max;
      bar.value = line.value;
    }
    section.append(
      el(doc, "p", { role: "status", "data-part": "progress" }, line.text),
      bar,
      ...(line.wait ? [el(doc, "p", { class: "maint-wait", "data-part": "wait" }, line.wait)] : []),
      ...(run.note ? [el(doc, "p", { class: "maint-note" }, run.note)] : []),
    );
    return section;
  }
  section.append(
    run.status === "failed"
      ? el(
          doc,
          "div",
          { class: "desk-error", role: "alert", "data-part": "ended" },
          el(doc, "p", {}, `${endedOf(run)} ${run.error}`),
        )
      : el(
          doc,
          "p",
          { role: "status", "data-part": "ended" },
          run.status === "cancelled" ? `${endedOf(run)} ${run.error}` : endedOf(run),
        ),
  );
  if (run.note) section.append(el(doc, "p", { class: "maint-note" }, run.note));
  if (run.output.length)
    section.append(
      el(
        doc,
        "details",
        { class: "maint-output", "data-part": "output", open: true },
        el(
          doc,
          "summary",
          {},
          `The server's output (${run.output.length} ${run.output.length === 1 ? "line" : "lines"})`,
        ),
        el(doc, "pre", {}, run.output.join("\n")),
      ),
    );
  if (run.before && run.after) {
    const rows = compared(s.target, run.before, run.after);
    section.append(
      el(
        doc,
        "table",
        { class: "desk-table maint-stats", "data-part": "stats" },
        el(doc, "caption", {}, "Statistics before and after"),
        el(
          doc,
          "thead",
          {},
          el(
            doc,
            "tr",
            {},
            ...["", "Before", "After"].map((h) => el(doc, "th", { scope: "col" }, h)),
          ),
        ),
        el(
          doc,
          "tbody",
          {},
          ...rows.map((r) =>
            el(
              doc,
              "tr",
              r.changed ? { "data-changed": "true" } : {},
              el(doc, "th", { scope: "row" }, r.label),
              el(doc, "td", {}, r.before),
              el(doc, "td", {}, r.after),
            ),
          ),
        ),
      ),
    );
  }
  return section;
}
