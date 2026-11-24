// The activity panel's sections (panel.js holds the toolbar and draws these on each new state): who
// waits for whom as a tree, the sessions as a table whose columns sort, the selected session's
// statement with Cancel and End, and the locks. A row and a tree item carry the session's process
// id (`data-pid`), a column's button its sort key (`data-sort`), a button its control
// (`data-ctl`); panel.js listens for them. Colours are activity.css's tokens.

import { el } from "../../dom.js";
import { oneLine } from "../../execute.js";
import { durationOf, lockText, waitText } from "./model.js";
import { nothingToCancel, refusal } from "./signal.js";
import { blockingTree } from "./tree.js";

/**
 * @typedef {import("./model.js").Session} Session
 * @typedef {import("./model.js").Read} Read
 * @typedef {import("./model.js").SortKey} SortKey
 * @typedef {import("./tree.js").TreeNode} TreeNode
 * @typedef {import("./controller.js").ActivityState} ActivityState
 */

/** The sessions' columns: heading, sort key, the cell's text. */
const COLUMNS = /** @type {const} */ ([
  ["PID", "pid"],
  ["User", "user"],
  ["Database", "database"],
  ["Application", "application"],
  ["Client", "client"],
  ["State", "state"],
  ["In state", "stateMs"],
  ["Transaction", "xactMs"],
  ["Query", "queryMs"],
  ["Waits for", "wait"],
]);
/** At most this many locks are drawn; the rest are counted. */
const LOCKS_DRAWN = 200;
/** What marks the view's own session and the plugin's others on this desk. */
const MARKS = { view: "this view", desk: "this app", "": "" };

const who = (/** @type {Session | undefined} */ s) =>
  s ? `${s.user ?? "another role"}${s.application ? ` · ${s.application}` : ""}` : "";
const section = (
  /** @type {Document} */ doc,
  /** @type {string} */ part,
  /** @type {string} */ title,
) => el(doc, "section", { "data-part": part, class: "activity-section" }, el(doc, "h2", {}, title));

/**
 * Who waits for whom, in the database the filter keeps; empty when nobody waits.
 * @param {Document} doc
 * @param {ActivityState} state
 */
export function treeSection(doc, state) {
  const read = state.read;
  const db = state.filters.database;
  const roots = read
    ? blockingTree(read.sessions, read.locks).filter((n) => !db || n.session?.database === db)
    : [];
  const waiting = read?.sessions.filter((s) => s.blockedBy.length).length ?? 0;
  const box = section(doc, "tree", `Waiting (${waiting})`);
  box.hidden = roots.length === 0;
  const item = (/** @type {TreeNode} */ node) => {
    const s = node.session;
    const name = node.pid === 0 ? "a prepared transaction" : `${node.pid} ${who(s)}`;
    const line = node.lock
      ? `${name} waits ${durationOf(node.waitMs)} for ${lockText(node.lock)}${node.held ? `, held as ${node.held.mode}` : ""}`
      : `${name}${s?.state ? ` · ${s.state}` : ""}${s?.xactMs ? ` · in a transaction for ${durationOf(s.xactMs)}` : ""}`;
    const li = el(
      doc,
      "li",
      {
        role: "treeitem",
        "data-pid": String(node.pid),
        "aria-expanded": node.children.length ? "true" : undefined,
      },
      el(
        doc,
        "span",
        { class: "activity-node" },
        node.again ? `${line} (again: they wait in a circle)` : line,
      ),
    );
    if (node.children.length)
      li.append(el(doc, "ul", { role: "group" }, ...node.children.map(item)));
    return li;
  };
  box.append(
    el(
      doc,
      "ul",
      { role: "tree", class: "activity-tree", "aria-label": "Who waits for whom" },
      ...roots.map(item),
    ),
  );
  return box;
}

/**
 * The sessions the filters leave, in the order asked, and the selected one's details.
 * @param {Document} doc
 * @param {ActivityState} state
 * @param {Session[]} shown
 */
export function sessionsSection(doc, state, shown) {
  const total = state.read?.sessions.length ?? 0;
  const box = section(doc, "sessions", `Sessions (${shown.length} of ${total})`);
  const { key, desc } = state.sort;
  const head = el(
    doc,
    "tr",
    {},
    ...COLUMNS.map(([label, sort]) =>
      el(
        doc,
        "th",
        {
          scope: "col",
          "aria-sort": sort === key ? (desc ? "descending" : "ascending") : undefined,
        },
        el(
          doc,
          "button",
          { type: "button", class: "desk-btn desk-btn-quiet", "data-sort": sort },
          sort === key ? `${label} ${desc ? "↓" : "↑"}` : label,
        ),
      ),
    ),
    el(doc, "th", { scope: "col" }, "Statement"),
  );
  const focusable = shown.some((s) => s.pid === state.selected) ? state.selected : shown[0]?.pid;
  const rows = shown.map((s) =>
    el(
      doc,
      "tr",
      {
        "data-pid": String(s.pid),
        "aria-selected": String(s.pid === state.selected),
        tabindex: s.pid === focusable ? "0" : "-1",
      },
      el(
        doc,
        "td",
        {},
        String(s.pid),
        s.own ? el(doc, "span", { class: "desk-badge" }, MARKS[s.own]) : undefined,
      ),
      ...[s.user, s.database, s.application, s.client, s.state].map((v) =>
        el(doc, "td", {}, v ?? ""),
      ),
      ...[s.stateMs, s.xactMs, s.queryMs].map((ms) =>
        el(doc, "td", { class: "activity-age" }, durationOf(ms)),
      ),
      el(
        doc,
        "td",
        {},
        `${waitText(s) ?? ""}${s.blockedBy.length ? ` · by ${s.blockedBy.join(", ")}` : ""}`,
      ),
      el(doc, "td", { class: "activity-sql" }, s.hidden ? "hidden" : oneLine(s.query ?? "")),
    ),
  );
  const table = el(
    doc,
    "table",
    { class: "desk-table activity-table", "aria-label": "Sessions" },
    el(doc, "thead", {}, head),
    el(doc, "tbody", {}, ...rows),
  );
  box.append(el(doc, "div", { class: "activity-scroll" }, table));
  const picked = state.read?.sessions.find((s) => s.pid === state.selected);
  if (picked) box.append(details(doc, state, picked));
  else if (shown.length === 0)
    box.append(el(doc, "p", { class: "desk-muted" }, "No session is left by the filters."));
  return box;
}

/** The selected session: who, its statement (cut, whole on request), Cancel and End. */
function details(
  /** @type {Document} */ doc,
  /** @type {ActivityState} */ state,
  /** @type {Session} */ s,
) {
  const query = s.hidden
    ? "Hidden: the pg_read_all_stats role shows it."
    : (s.query ?? "No statement yet.");
  const long = query.length > 400;
  const where = [
    `${s.user ?? "another role"} on ${s.database ?? "no database"}`,
    s.application,
    s.client,
    s.state ? `${s.state} for ${durationOf(s.stateMs)}` : "",
  ];
  const refused = refusal(/** @type {never} */ (state.conn));
  const box = el(
    doc,
    "div",
    { class: "activity-details", "aria-label": `Session ${s.pid}` },
    el(doc, "p", { class: "activity-who" }, `${s.pid} · ${where.filter(Boolean).join(" · ")}`),
    el(
      doc,
      "pre",
      { class: "activity-query" },
      long && !state.whole ? `${query.slice(0, 399)}…` : query,
    ),
    el(
      doc,
      "div",
      { class: "activity-actions" },
      long
        ? el(
            doc,
            "button",
            { type: "button", class: "desk-btn desk-btn-quiet", "data-ctl": "whole" },
            state.whole ? "Shorter" : "Whole statement",
          )
        : undefined,
      el(
        doc,
        "button",
        {
          type: "button",
          class: "desk-btn",
          "data-ctl": "cancel",
          disabled: Boolean(refused || nothingToCancel(s)),
          title: nothingToCancel(s) || "Cancel its statement (c)",
        },
        "Cancel statement",
      ),
      el(
        doc,
        "button",
        {
          type: "button",
          class: "desk-btn desk-btn-danger",
          "data-ctl": "end",
          disabled: Boolean(refused) || s.own === "view",
          title: "End the session (e)",
        },
        "End session",
      ),
    ),
  );
  if (refused) box.append(el(doc, "p", { class: "desk-muted" }, refused));
  return box;
}

/**
 * The locks in the database the filter keeps (without the view's reads'), waiting ones first.
 * @param {Document} doc
 * @param {ActivityState} state
 */
export function locksSection(doc, state) {
  const read = /** @type {Read} */ (state.read);
  const { database, own } = state.filters;
  const reads = new Set(read.sessions.filter((s) => s.reads).map((s) => s.pid)).add(read.own);
  const locks = read.locks.filter(
    (l) =>
      (!database || l.database === null || l.database === database) && !(own && reads.has(l.pid)),
  );
  const box = section(doc, "locks", `Locks (${locks.length}${read.more ? "+" : ""})`);
  const heads = ["PID", "Type", "On", "Mode", "Held", "Waiting for"];
  const rows = locks
    .slice(0, LOCKS_DRAWN)
    .map((l) =>
      el(
        doc,
        "tr",
        { "data-pid": String(l.pid) },
        ...[
          String(l.pid),
          l.type,
          l.target,
          l.mode,
          l.granted ? "held" : "waiting",
          durationOf(l.waitMs),
        ].map((v) => el(doc, "td", {}, v)),
      ),
    );
  const table = el(
    doc,
    "table",
    { class: "desk-table activity-table", "aria-label": "Locks" },
    el(
      doc,
      "thead",
      {},
      el(doc, "tr", {}, ...heads.map((h) => el(doc, "th", { scope: "col" }, h))),
    ),
    el(doc, "tbody", {}, ...rows),
  );
  box.append(el(doc, "div", { class: "activity-scroll" }, table));
  if (locks.length > LOCKS_DRAWN)
    box.append(
      el(
        doc,
        "p",
        { class: "desk-muted" },
        `The first ${LOCKS_DRAWN} of ${locks.length} locks, the waiting ones first.`,
      ),
    );
  return box;
}
