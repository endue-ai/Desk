// The totals of the grid's selection in the page's footer (PG-44, `#totals`): when a block is more
// than one cell, its count, distinct count, sum, average, minimum and maximum (aggregate.js, exact),
// its NULLs, and that the result has rows that were not fetched. grid/screen.js asks after each
// paint; the totals are counted again only when the block, the rows' order or the changes moved,
// in the chart's worker past 20,000 cells, and only the latest answer is shown. They go when the
// grid leaves the page (a Messages, plan or Chart tab) or the record view is on.

import { formatCount } from "../format.js";
import { chartClient } from "./client.js";

/**
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("../edit/pending.js").Changes} Changes
 * @typedef {import("./aggregate.js").Totals} Totals
 * @typedef {{
 *   set(): ResultSet | undefined, changes(): Changes | null, rows(): number[], columns(): number[],
 *   record(): boolean, cells(): number,
 * }} Read
 *   The block's result rows and columns, and how many screen cells it covers.
 */

const SHORT = 40;
const cut = (/** @type {string} */ s) => (s.length > SHORT ? `${s.slice(0, SHORT - 1)}…` : s);

/** The totals in words, for the footer; `whole` keeps long values whole (the title). */
export function totalsText(
  /** @type {Totals} */ t,
  /** @type {{ rows: unknown[], truncated: boolean }} */ set,
  whole = false,
) {
  const v = (/** @type {string} */ s) => (whole ? s : cut(s));
  const parts = [`Count ${formatCount(t.count)}`, `Distinct ${formatCount(t.distinct)}`];
  if (t.sum !== null) parts.push(`Sum ${v(t.sum)}`);
  if (t.average !== null) parts.push(`Average ${v(t.average)}`);
  if (t.min !== null) parts.push(`Min ${v(t.min)}`);
  if (t.max !== null) parts.push(`Max ${v(t.max)}`);
  if (t.nulls) parts.push(`${formatCount(t.nulls)} NULL`);
  if (set.truncated) parts.push(`of the ${formatCount(set.rows.length)} rows fetched (more not loaded)`);
  return parts.join(" · ");
}

/**
 * @param {Document} doc
 * @param {HTMLElement} scroller The grid's scroller: the totals go when it leaves the page.
 * @param {Read} read
 * @param {import("./client.js").StartWorker} [startWorker]
 */
export function createTotals(doc, scroller, read, startWorker) {
  const client = chartClient(startWorker);
  let key = "";
  let asked = 0;
  /** @type {ResultSet | undefined} */
  let counted;
  /** @type {MutationObserver | undefined} */
  let watching;
  const out = () => /** @type {HTMLElement | null} */ (doc.getElementById("totals"));
  const say = (/** @type {string} */ text, /** @type {string} */ title = text) => {
    const shown = out();
    if (!shown) return;
    shown.textContent = text;
    shown.title = title;
  };
  const clear = () => {
    key = "";
    asked++;
    say("");
  };
  /** Clear when the grid's host shows something else. */
  const watch = () => {
    const host = scroller.parentElement;
    const Observer = doc.defaultView?.MutationObserver;
    if (watching || !host || !Observer) return;
    watching = new Observer(() => {
      if (!scroller.isConnected || scroller.parentElement !== host) clear();
    });
    watching.observe(host, { childList: true });
  };

  return {
    /** Count the block again if it moved. */
    update() {
      const set = read.set();
      if (!set || read.record() || read.cells() < 2 || !scroller.isConnected) return clear();
      watch();
      const rows = read.rows();
      const columns = read.columns();
      const changes = read.changes();
      const changed = changes ? changes.updates.size + changes.inserts.length * 1e6 : 0;
      const next = `${rows[0]}:${rows.at(-1)}:${rows.length}:${columns.join(",")}:${changed}`;
      if (counted === set && next === key) return undefined;
      counted = set;
      key = next;
      const id = ++asked;
      const show = (/** @type {Totals} */ t) => {
        if (id === asked) say(totalsText(t, set), totalsText(t, set, true));
      };
      const got = client.totals(set, changes, rows, columns);
      if ("then" in got) void got.then(show, () => id === asked && say(""));
      else show(got);
      return undefined;
    },
  };
}
