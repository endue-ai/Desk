// A source search's results (panel.js draws the form and calls this on each new state): a sentence
// of what it found and how far it went, the notes (bodies that could not be read, the lines capped),
// then a section per object: its name, its kind, where it is (the connection, the schema, a part's
// table) and its matching lines, each with its number and the matched text marked; a line opens the
// source there. While a search runs, only the objects new since the last state are drawn.

import { el } from "../../dom.js";
import { formatCount } from "../../format.js";
import { LINES_CAP, summaryText } from "./model.js";

/**
 * @typedef {import("./model.js").Run} Run
 * @typedef {import("./model.js").Hit} Hit
 * @typedef {(object: number, line: number) => void} Open
 */

/** A line's text with its ranges marked. */
function marked(/** @type {Document} */ doc, /** @type {import("./match.js").Line} */ line) {
  /** @type {(Node | string)[]} */
  const parts = [];
  let at = 0;
  for (const [from, to] of line.ranges) {
    if (from > at) parts.push(line.text.slice(at, from));
    parts.push(el(doc, "mark", { class: "src-mark" }, line.text.slice(from, to)));
    at = to;
  }
  if (at < line.text.length) parts.push(line.text.slice(at));
  return el(doc, "span", { class: "src-code" }, ...parts);
}

/**
 * @param {Document} doc
 * @param {Open} open
 */
export function createResults(doc, open) {
  const summary = el(doc, "p", { class: "src-summary", "data-part": "summary" });
  const notes = el(doc, "div", { class: "src-notes" });
  const list = el(doc, "div", { class: "src-list", "data-part": "objects" });
  const root = el(
    doc,
    "div",
    { class: "src-results", "aria-live": "polite" },
    summary,
    notes,
    list,
  );
  let drawn = { started: -1, count: 0 };

  root.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (event.target).closest("[data-open]")
    );
    if (!target) return;
    const [o, l] = (target.dataset.open ?? "").split(".").map(Number);
    if (o === undefined || l === undefined || Number.isNaN(o) || Number.isNaN(l)) return;
    open(o, l);
  });

  const section = (/** @type {Hit} */ h, /** @type {number} */ at) => {
    const where = [h.where, h.schema, h.table ? `on ${h.table}` : ""].filter(Boolean).join(" · ");
    const lines = h.lines.map((line, li) =>
      el(
        doc,
        "li",
        {},
        el(
          doc,
          "button",
          {
            type: "button",
            class: "desk-btn desk-btn-quiet src-line",
            "data-open": `${at}.${li}`,
            title: `Open ${h.name} at line ${line.line}`,
          },
          el(doc, "span", { class: "src-number" }, String(line.line)),
          marked(doc, line),
        ),
      ),
    );
    const rest = h.count - h.lines.length;
    return el(
      doc,
      "section",
      {
        class: "src-object",
        "data-object": `${h.kind} ${h.schema}.${h.table ? `${h.table}.` : ""}${h.name}`,
      },
      el(
        doc,
        "div",
        { class: "src-object-head" },
        el(doc, "h3", { class: "src-object-name" }, h.name),
        el(doc, "span", { class: "desk-badge" }, h.kind),
        el(doc, "span", { class: "src-where" }, where),
      ),
      el(doc, "ul", { class: "src-lines" }, ...lines),
      rest > 0
        ? el(
            doc,
            "p",
            { class: "src-more" },
            `and ${formatCount(rest)} more ${rest === 1 ? "line" : "lines"}`,
          )
        : undefined,
    );
  };

  return {
    el: root,
    /** Draw a run's results; nothing before the first search. */
    draw(/** @type {Run | null} */ run) {
      root.hidden = !run;
      if (!run) return;
      if (drawn.started !== run.started || run.objects.length < drawn.count) {
        list.replaceChildren();
        drawn = { started: run.started, count: 0 };
      }
      for (let i = drawn.count; i < run.objects.length; i++)
        list.append(section(/** @type {Hit} */ (run.objects[i]), i));
      drawn.count = run.objects.length;
      summary.textContent = run.phase === "running" ? "" : summaryText(run);
      summary.hidden = run.phase === "running";
      const said = [
        ...run.notes,
        run.capped
          ? `Only the first ${formatCount(LINES_CAP)} lines in all, and 50 an object, are kept; the counts cover every line.`
          : "",
      ].filter(Boolean);
      notes.replaceChildren(
        ...said.map((text) =>
          el(
            doc,
            "div",
            { class: "desk-callout", "data-tone": "info" },
            el(doc, "div", { class: "desk-callout-body" }, text),
          ),
        ),
      );
    },
  };
}
