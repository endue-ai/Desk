// A search's results (panel.js draws the form and calls this on each new state): a sentence of what
// it found and how far it went, a note when the hits were capped, then a section per table with a
// match: its name, whether an index served the search or the table was read in full, how its rows
// are named when it has no primary key, and per column its count (which opens the table filtered to
// those matches) and its first hits (each opens the table filtered to its row). Then the tables not
// searched and why. While a search runs, only the tables new since the last state are drawn.

import { el } from "../../dom.js";
import { formatCount } from "../../format.js";
import { t as messageText } from "../../strings/index.js";
import { countText, HIT_CAP, summaryText, whyText } from "./model.js";

/**
 * @typedef {import("./model.js").Run} Run
 * @typedef {import("./model.js").TableHits} TableHits
 * @typedef {(table: number, column: number, hit?: number) => void} Open
 */

/** At most this many hits are drawn per column; the rest are counted. */
export const HITS_DRAWN = 20;

const SCAN = { index: "by an index", full: "read in full", "": "" };
const BY = {
  key: "",
  ctid: "no primary key: rows by ctid",
  rowid: "no primary key: rows by rowid",
  match: "no primary key: rows by the match",
};

/** A hit's key as it reads: `id 17`, `(0,5)`. */
function keyText(/** @type {TableHits} */ t, /** @type {(string | null)[]} */ key) {
  if (t.key.by === "key") return t.key.columns.map((c, i) => `${c} ${key[i] ?? "NULL"}`).join(", ");
  if (t.key.by === "ctid") return key.filter(Boolean).join(" in ");
  if (t.key.by === "rowid") return `rowid ${key[0] ?? ""}`;
  return "a matching row";
}

/**
 * @param {Document} doc
 * @param {Open} open
 */
export function createResults(doc, open) {
  const summary = el(doc, "p", { class: "search-summary", "data-part": "summary" });
  const notes = el(doc, "div", { class: "search-notes" });
  const list = el(doc, "div", { class: "search-list", "data-part": "tables" });
  const skipped = el(doc, "section", { class: "search-skipped", "data-part": "skipped" });
  const root = el(
    doc,
    "div",
    { class: "search-results", "aria-live": "polite" },
    summary,
    notes,
    list,
    skipped,
  );
  /** The run drawn (its start) and how many of its tables are. */
  let drawn = { started: -1, count: 0 };

  root.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (event.target).closest("[data-open]")
    );
    if (!target) return;
    const [t, c, h] = (target.dataset.open ?? "").split(".").map(Number);
    if (t === undefined || c === undefined || Number.isNaN(t) || Number.isNaN(c)) return;
    open(t, c, h === undefined || Number.isNaN(h) ? undefined : h);
  });

  /** One table's section. */
  const section = (/** @type {TableHits} */ t, /** @type {number} */ at) => {
    const badges = [SCAN[t.scan], BY[t.key.by]].filter(Boolean);
    const columns = t.columns.map((c, ci) => {
      const head = el(
        doc,
        "button",
        {
          type: "button",
          class: "desk-btn desk-btn-quiet search-column",
          "data-open": `${at}.${ci}`,
          title: messageText("features.search.results.openFilteredToTheRowsWhose", {
            name: String(t.name),
            name2: String(c.name),
          }),
        },
        el(doc, "span", { class: "search-column-name" }, c.name),
        el(doc, "span", { class: "search-column-type" }, c.type),
        el(doc, "span", { class: "search-count" }, countText(c.count, t.more)),
      );
      const hits = c.hits.slice(0, HITS_DRAWN).map((h, hi) =>
        el(
          doc,
          "li",
          {},
          el(
            doc,
            "button",
            {
              type: "button",
              class: "desk-btn desk-btn-quiet search-hit",
              "data-open": `${at}.${ci}.${hi}`,
              title: messageText("features.search.results.openTheTableFilteredToThis"),
            },
            el(doc, "span", { class: "search-key" }, keyText(t, h.key)),
            el(doc, "span", { class: "search-text" }, h.text),
          ),
        ),
      );
      const rest = c.count - Math.min(c.hits.length, HITS_DRAWN);
      return el(
        doc,
        "li",
        { class: "search-column-item" },
        head,
        el(doc, "ul", { class: "search-hits" }, ...hits),
        rest > 0
          ? el(
              doc,
              "p",
              { class: "search-more" },
              messageText("features.search.results.andMoreOpenTheColumnTo", {
                value: String(formatCount(rest)),
              }),
            )
          : undefined,
      );
    });
    return el(
      doc,
      "section",
      { class: "search-table", "data-table": `${t.schema}.${t.name}` },
      el(
        doc,
        "div",
        { class: "search-table-head" },
        el(doc, "h3", { class: "search-table-name" }, `${t.schema}.${t.name}`),
        ...badges.map((b) => el(doc, "span", { class: "desk-badge" }, b)),
      ),
      el(doc, "ul", { class: "search-columns" }, ...columns),
    );
  };

  return {
    el: root,
    /** Draw a run's results; nothing before the first search. */
    draw(/** @type {Run | null} */ run) {
      root.hidden = !run;
      if (!run) return;
      if (drawn.started !== run.started || run.tables.length < drawn.count) {
        list.replaceChildren();
        drawn = { started: run.started, count: 0 };
      }
      for (let i = drawn.count; i < run.tables.length; i++)
        list.append(section(/** @type {TableHits} */ (run.tables[i]), i));
      drawn.count = run.tables.length;
      summary.textContent = run.phase === "running" ? "" : summaryText(run);
      summary.hidden = run.phase === "running";
      const said = [
        run.capped
          ? messageText("features.search.results.onlyTheFirstHitsAreKept", {
              value: String(formatCount(HIT_CAP)),
            })
          : "",
        run.empty
          ? messageText("features.search.results.noColumnOfTheChosenKinds", {
              value: String(formatCount(run.empty)),
              value2: String(
                run.empty === 1
                  ? messageText("features.search.results.tableHas")
                  : messageText("features.search.results.tablesHave"),
              ),
            })
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
      skipped.hidden = run.skipped.length === 0;
      skipped.replaceChildren(
        el(
          doc,
          "h3",
          { class: "search-table-name" },
          messageText("features.search.results.notSearched", {
            value: String(formatCount(run.skipped.length)),
          }),
        ),
        el(
          doc,
          "ul",
          { class: "search-skipped-list" },
          ...run.skipped.map((s) =>
            el(
              doc,
              "li",
              { "data-why": s.why },
              el(doc, "span", { class: "search-key" }, `${s.schema}.${s.name}`),
              ` ${whyText(s)}`,
            ),
          ),
        ),
      );
    },
  };
}
