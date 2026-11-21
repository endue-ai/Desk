// The server's activity as the view holds it: the sessions and locks read from the rows sql.js's
// statements answer, what the person's filters leave and in which order, what a role cannot see,
// ages in words, and the answer agents get (who waits for whom from tree.js). A NULL is no value,
// never 0 or "", and the fixture server's empty text reads as NULL too. No DOM.

import { formatCount } from "../../format.js";
import { OWN_APPLICATION } from "./sql.js";
import { blockingTree, lockText } from "./tree.js";

export { blockingTree, lockText };

/**
 * @typedef {{
 *   pid: number, leader: number | null, user: string | null, database: string | null,
 *   application: string | null, client: string | null, backend: string | null,
 *   state: string | null, waitType: string | null, wait: string | null,
 *   stateMs: number | null, xactMs: number | null, queryMs: number | null,
 *   blockedBy: number[], query: string | null, hidden: boolean, own: "" | "view" | "plugin",
 * }} Session
 *   `own` marks the session that read the view and the plugin's other sessions; `hidden`, one
 *   whose statement, state and waits the role may not see.
 * @typedef {import("./tree.js").Lock} Lock
 * @typedef {{
 *   version: number, server: string, own: number, database: string, at: number,
 *   sessions: Session[], locks: Lock[], more: boolean,
 * }} Read
 *   `more`: the server holds more locks than were read.
 * @typedef {{ idle: boolean, own: boolean, system: boolean, database: string }} Filters
 *   `idle` hides idle sessions, `own` the view's own, `system` shows background processes, and a
 *   `database` other than "" keeps that one's.
 * @typedef {"pid" | "user" | "database" | "application" | "client" | "state" | "stateMs" | "xactMs" | "queryMs" | "wait"} SortKey
 * @typedef {{ key: SortKey, desc: boolean }} Sort
 */

/** What the server shows for another role's statement without pg_read_all_stats. */
const HIDDEN = "<insufficient privilege>";
export const SORT_KEYS = /** @type {SortKey[]} */ ([
  "pid",
  "user",
  "database",
  "application",
  "client",
  "state",
  "stateMs",
  "xactMs",
  "queryMs",
  "wait",
]);
/** The periods the panel reads again at, in seconds. */
export const PERIODS = [2, 5, 10, 30, 60];
/** @type {{ filters: Filters, sort: Sort }} */
export const DEFAULT_VIEW = {
  filters: { idle: true, own: true, system: false, database: "" },
  sort: { key: "xactMs", desc: true },
};

const text = (/** @type {unknown} */ value) =>
  value === null || value === undefined || value === "" ? null : String(value);
const number = (/** @type {unknown} */ value) => {
  const t = text(value);
  return t === null || Number.isNaN(Number(t)) ? null : Number(t);
};

/**
 * One read: the head's version, the sessions and the locks.
 * @param {(string | null)[]} head
 * @param {(string | null)[][]} sessions
 * @param {(string | null)[][]} locks
 * @param {boolean} more
 * @param {number} at when it was read
 * @returns {Read}
 */
export function readOf(head, sessions, locks, more, at) {
  const own = number(head[2]) ?? 0;
  return {
    version: number(head[0]) ?? 0,
    server: text(head[1]) ?? "",
    own,
    database: text(head[3]) ?? "",
    at,
    sessions: sessions.map((row) => sessionOf(row, own)),
    locks: locks.map(lockOf),
    more,
  };
}

/** @returns {Session} */
function sessionOf(/** @type {(string | null)[]} */ row, /** @type {number} */ own) {
  const pid = number(row[0]) ?? 0;
  const query = text(row[15]);
  const host = text(row[5]);
  const application = text(row[4]);
  return {
    pid,
    leader: number(row[1]),
    user: text(row[2]),
    database: text(row[3]),
    application,
    client: host ?? (number(row[6]) === -1 ? "local" : null),
    backend: text(row[7]),
    state: text(row[8]),
    waitType: text(row[9]),
    wait: text(row[10]),
    stateMs: number(row[11]),
    xactMs: number(row[12]),
    queryMs: number(row[13]),
    blockedBy: (text(row[14]) ?? "").split(" ").filter(Boolean).map(Number),
    query: query === HIDDEN ? null : query,
    hidden: query === HIDDEN,
    own: pid === own ? "view" : application === OWN_APPLICATION ? "plugin" : "",
  };
}

/** @returns {Lock} */
function lockOf(/** @type {(string | null)[]} */ row) {
  const type = text(row[1]) ?? "";
  return {
    pid: number(row[0]) ?? 0,
    type,
    mode: text(row[2]) ?? "",
    granted: row[3] === "t" || row[3] === "true",
    database: text(row[4]),
    target: targetOf(type, row.map(text)),
    waitMs: number(row[11]),
  };
}

/** What a lock is on: a relation (with its page and tuple), a transaction, or its type and id. */
function targetOf(/** @type {string} */ type, /** @type {(string | null)[]} */ row) {
  const [relation, page, tuple, virtual, xid, objid] = row.slice(5, 11);
  if (type === "transactionid") return `transaction ${xid}`;
  if (type === "virtualxid") return `virtual transaction ${virtual}`;
  if (relation === null || relation === undefined) return objid ? `${type} ${objid}` : type;
  if (tuple !== null && tuple !== undefined) return `${relation} (page ${page}, tuple ${tuple})`;
  if (page !== null && page !== undefined) return `${relation} (page ${page})`;
  return type === "extend" ? `${relation} (extension)` : relation;
}

/** A background process (no client): its type says so, or, hidden, it has no database. */
export const isBackground = (/** @type {Session} */ s) =>
  s.backend !== null ? s.backend !== "client backend" : s.database === null;

/** The sessions the filters leave. */
export function visible(/** @type {Session[]} */ sessions, /** @type {Filters} */ filters) {
  return sessions.filter(
    (s) =>
      !(filters.idle && s.state === "idle") &&
      !(filters.own && s.own === "view") &&
      (filters.system || !isBackground(s)) &&
      (filters.database === "" || s.database === filters.database),
  );
}

/** The sessions in the order asked, NULL last either way, ties by process id. */
export function sorted(/** @type {Session[]} */ sessions, /** @type {Sort} */ sort) {
  const field = (/** @type {Session} */ s) =>
    sort.key === "wait" ? waitText(s) : /** @type {string | number | null} */ (s[sort.key]);
  return [...sessions].sort((a, b) => {
    const [x, y] = [field(a), field(b)];
    if (x === null || y === null) return x === y ? a.pid - b.pid : x === null ? 1 : -1;
    const order =
      typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return (sort.desc ? -order : order) || a.pid - b.pid;
  });
}

/** What a session waits for in words ("Lock: transactionid"), or null. */
export const waitText = (/** @type {Session} */ s) =>
  s.waitType === null ? null : `${s.waitType}${s.wait !== null ? `: ${s.wait}` : ""}`;

/** The sentence about the sessions whose statement the role may not see, or "". */
export function hiddenOf(/** @type {Session[]} */ sessions) {
  const n = sessions.filter((s) => s.hidden && !isBackground(s)).length;
  if (n === 0) return "";
  const what =
    n === 1
      ? "1 session of another role hides its statement, state and waits"
      : `${formatCount(n)} sessions of other roles hide their statements, states and waits`;
  return `${what}: the pg_read_all_stats role (or a superuser) shows them.`;
}

/** An age in words: 850 ms, 12 s, 1 min 35 s, 2 h 5 min, 1 d 1 h; "" for none. */
export function durationOf(/** @type {number | null} */ ms) {
  if (ms === null) return "";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const s = Math.floor(ms / 1000);
  const two = (
    /** @type {number} */ big,
    /** @type {string} */ a,
    /** @type {number} */ small,
    /** @type {string} */ b,
  ) => (small ? `${big} ${a} ${small} ${b}` : `${big} ${a}`);
  if (s < 60) return `${s} s`;
  if (s < 3600) return two(Math.floor(s / 60), "min", s % 60, "s");
  if (s < 86400) return two(Math.floor(s / 3600), "h", Math.floor((s % 3600) / 60), "min");
  return two(Math.floor(s / 86400), "d", Math.floor((s % 86400) / 3600), "h");
}

const seconds = (/** @type {number | null} */ ms) => (ms === null ? null : Math.round(ms / 1000));

/** A read as agents get it: the sessions the default filters leave, and who waits for whom. */
export function summaryOf(/** @type {Read} */ read) {
  const shown = sorted(visible(read.sessions, DEFAULT_VIEW.filters), DEFAULT_VIEW.sort);
  /** @type {{ pid: number, waitsFor: number[], lock: string | null, waitSeconds: number | null }[]} */
  const waits = [];
  const walk = (/** @type {import("./tree.js").TreeNode[]} */ nodes) => {
    for (const node of nodes) {
      const waitsFor = node.session?.blockedBy ?? [];
      if (waitsFor.length && !waits.some((w) => w.pid === node.pid))
        waits.push({
          pid: node.pid,
          waitsFor,
          lock: node.lock ? lockText(node.lock) : null,
          waitSeconds: seconds(node.waitMs),
        });
      walk(node.children);
    }
  };
  walk(blockingTree(read.sessions, read.locks));
  return {
    server: read.server,
    sessions: shown.map((s) => ({
      pid: s.pid,
      user: s.user,
      database: s.database,
      application: s.application,
      client: s.client,
      state: s.state,
      wait: waitText(s),
      transactionSeconds: seconds(s.xactMs),
      statementSeconds: seconds(s.queryMs),
      blockedBy: s.blockedBy,
      statement: s.query && s.query.length > 500 ? `${s.query.slice(0, 499)}…` : s.query,
    })),
    waits,
    hidden: read.sessions.filter((s) => s.hidden && !isBackground(s)).length,
    ...(read.more ? { note: "The server holds more locks than were read." } : {}),
  };
}

/** The databases the sessions are in, sorted, for the filter. */
export const databasesOf = (/** @type {Session[]} */ sessions) =>
  [...new Set(sessions.flatMap((s) => (s.database === null ? [] : [s.database])))].sort();
