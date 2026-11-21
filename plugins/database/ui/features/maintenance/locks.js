// What a maintenance statement locks and for how long, in words for the person who starts it:
// which reads and writes wait (the lock it takes, by its PostgreSQL name), for a moment or for the
// whole run, the room a copy needs, what an option changes, the size that says how long it may
// take, and that it runs alone outside a transaction block. `heavy` marks what blocks reads or
// writes for the whole run (VACUUM FULL, CLUSTER, REINDEX without CONCURRENTLY). Pure.

import { sizeOf, summaryOf } from "./model.js";
import { on } from "./options.js";

/**
 * @typedef {import("./sql.js").Plan} Plan
 * @typedef {import("./model.js").Read} Read
 */

const QUEUE = "While it waits for its lock, sessions that come after it wait too.";

/** What the target is called in a sentence. */
function subjectOf(/** @type {Plan["target"]} */ t, /** @type {Read} */ read) {
  if (t.kind === "table") return `${t.schema}.${t.table}`;
  if (t.kind === "index") return `${t.schema}.${t.table || read.table}`;
  return t.kind === "schema" ? `each table of schema ${t.schema}` : "each table of the database";
}

/**
 * @param {Plan} plan
 * @param {Read} read
 * @param {number} timeoutSeconds the plugin's statement timeout, 0 for none
 * @returns {{ heavy: boolean, lines: string[] }}
 */
export function locksOf(plan, read, timeoutSeconds) {
  const { target: t, operation: op, options: o } = plan;
  const has = (/** @type {keyof import("./options.js").Options} */ key) =>
    on(key, op, t, read, o) && Boolean(o[key]);
  const one = t.kind === "table" || t.kind === "index";
  const who = subjectOf(t, read);
  const turn = one ? "" : ", one table at a time";
  const copy = `It needs free disk for the new copy, up to ${sizeOf(read.stats.total)} more, until it ends.`;
  /** @type {string[]} */
  const lines = [];
  let heavy = false;
  if (op === "vacuum" && o.full) {
    heavy = true;
    lines.push(
      `Every read and write of ${who} waits until it is written anew: VACUUM FULL takes ACCESS EXCLUSIVE${turn} and writes the table and its indexes anew.`,
      copy,
      QUEUE,
    );
  } else if (op === "vacuum") {
    lines.push(
      `Reads and writes of ${who} go on: VACUUM takes SHARE UPDATE EXCLUSIVE, so only ALTER TABLE, CREATE INDEX and another VACUUM or ANALYZE of it wait.`,
      o.truncate === "off"
        ? "TRUNCATE OFF: it never takes ACCESS EXCLUSIVE to give empty pages back."
        : "At the end it may take ACCESS EXCLUSIVE for a moment to give empty pages at the end of a table back, and lets go as soon as another session waits; TRUNCATE OFF skips that.",
    );
    if (has("freeze"))
      lines.push("FREEZE freezes every row it can: it reads the whole table and writes more.");
  } else if (op === "analyze") {
    lines.push(
      `Reads and writes of ${who} go on: ANALYZE takes SHARE UPDATE EXCLUSIVE and reads a sample of the rows, not the whole table.`,
    );
  } else if (op === "reindex" && has("concurrently")) {
    const room = sizeOf(t.kind === "index" ? read.stats.index : read.stats.indexes);
    lines.push(
      `Reads and writes of ${who} go on: REINDEX CONCURRENTLY takes SHARE UPDATE EXCLUSIVE, builds each index anew beside the old one and waits for transactions that could still use it, so it takes longer and needs room for a second copy (${room}).`,
      "If it fails or is cancelled, an invalid index whose name ends in _ccnew stays behind: drop it, or run REINDEX again.",
    );
    if (t.kind === "database")
      lines.push("System catalogs are skipped: they cannot be reindexed concurrently.");
  } else if (op === "reindex") {
    heavy = true;
    lines.push(
      t.kind === "index"
        ? `Writes to ${who} wait until it ends (SHARE), and the index is locked ACCESS EXCLUSIVE while it is built anew; planning a query on the table locks all its indexes, so nearly every read waits too.`
        : `Writes to ${who} wait while its indexes are built anew (SHARE${turn}), and each index is locked ACCESS EXCLUSIVE meanwhile; planning a query on a table locks all its indexes, so nearly every read waits too.`,
      "CONCURRENTLY keeps reads and writes going.",
      QUEUE,
    );
  } else if (t.kind === "database") {
    heavy = true;
    lines.push(
      "Each table clustered before (and owned by this role) is written anew in its index's order, one at a time: every read and write of that table waits meanwhile (ACCESS EXCLUSIVE).",
      QUEUE,
    );
  } else {
    heavy = true;
    const using = t.kind === "index" ? t.index : o.using || "its index";
    lines.push(
      `Every read and write of ${who} waits until it ends: CLUSTER takes ACCESS EXCLUSIVE and writes the table anew in the order of ${using}, then builds its indexes.`,
      copy,
      QUEUE,
    );
  }
  if (op === "vacuum" && has("analyze"))
    lines.push(
      "ANALYZE: then it reads a sample of the rows for the planner's statistics, under the same lock.",
    );
  if (has("skipLocked"))
    lines.push(
      "SKIP_LOCKED: a table another session holds a conflicting lock on is skipped, not waited for.",
    );
  if (has("tablespace")) lines.push(`TABLESPACE: the indexes built anew go to ${o.tablespace}.`);
  lines.push(`How long depends on the size: ${summaryOf(t, read.stats)}.`);
  lines.push(
    "The plugin sends it alone, outside a transaction block: VACUUM, REINDEX CONCURRENTLY, REINDEX of a schema or a database and CLUSTER of a database or a partitioned table cannot run inside one.",
  );
  if (timeoutSeconds > 0)
    lines.push(
      `The statement timeout in the settings (${timeoutSeconds} s) ends it if it runs longer.`,
    );
  return { heavy, lines };
}
