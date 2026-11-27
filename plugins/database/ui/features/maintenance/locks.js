// What a maintenance statement locks and for how long, in words for the person who starts it:
// which reads and writes wait (the lock it takes, by its PostgreSQL name), for a moment or for the
// whole run, the room a copy needs, what an option changes, the size that says how long it may
// take, and that it runs alone outside a transaction block. `heavy` marks what blocks reads or
// writes for the whole run (VACUUM FULL, CLUSTER, REINDEX without CONCURRENTLY). Pure.

import { t as messageText } from "../../strings/index.js";
import { sizeOf, summaryOf } from "./model.js";
import { on } from "./options.js";

/**
 * @typedef {import("./sql.js").Plan} Plan
 * @typedef {import("./model.js").Read} Read
 */

const QUEUE = messageText("features.maintenance.locks.whileItWaitsForItsLock");

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
  const copy = messageText("features.maintenance.locks.itNeedsFreeDiskForThe", {
    value: String(sizeOf(read.stats.total)),
  });
  /** @type {string[]} */
  const lines = [];
  let heavy = false;
  if (op === "vacuum" && o.full) {
    heavy = true;
    lines.push(
      messageText("features.maintenance.locks.everyReadAndWriteOfWaits", {
        who: String(who),
        turn: String(turn),
      }),
      copy,
      QUEUE,
    );
  } else if (op === "vacuum") {
    lines.push(
      messageText("features.maintenance.locks.readsAndWritesOfGoOn", { who: String(who) }),
      o.truncate === "off"
        ? messageText("features.maintenance.locks.truncateOffItNeverTakesAccess")
        : messageText("features.maintenance.locks.atTheEndItMayTake"),
    );
    if (has("freeze"))
      lines.push(messageText("features.maintenance.locks.freezeFreezesEveryRowItCan"));
  } else if (op === "analyze") {
    lines.push(
      messageText("features.maintenance.locks.readsAndWritesOfGoOn2", { who: String(who) }),
    );
  } else if (op === "reindex" && has("concurrently")) {
    const room = sizeOf(t.kind === "index" ? read.stats.index : read.stats.indexes);
    lines.push(
      messageText("features.maintenance.locks.readsAndWritesOfGoOn3", {
        who: String(who),
        room: String(room),
      }),
      messageText("features.maintenance.locks.ifItFailsOrIsCancelled"),
    );
    if (t.kind === "database")
      lines.push(messageText("features.maintenance.locks.systemCatalogsAreSkippedTheyCannot"));
  } else if (op === "reindex") {
    heavy = true;
    lines.push(
      t.kind === "index"
        ? messageText("features.maintenance.locks.writesToWaitUntilItEnds", { who: String(who) })
        : messageText("features.maintenance.locks.writesToWaitWhileItsIndexes", {
            who: String(who),
            turn: String(turn),
          }),
      messageText("features.maintenance.locks.concurrentlyKeepsReadsAndWritesGoing"),
      QUEUE,
    );
  } else if (t.kind === "database") {
    heavy = true;
    lines.push(messageText("features.maintenance.locks.eachTableClusteredBeforeAndOwned"), QUEUE);
  } else {
    heavy = true;
    const using = t.kind === "index" ? t.index : o.using || "its index";
    lines.push(
      messageText("features.maintenance.locks.everyReadAndWriteOfWaits2", {
        who: String(who),
        using: String(using),
      }),
      copy,
      QUEUE,
    );
  }
  if (op === "vacuum" && has("analyze"))
    lines.push(
      "ANALYZE: then it reads a sample of the rows for the planner's statistics, under the same lock.",
    );
  if (has("skipLocked"))
    lines.push(messageText("features.maintenance.locks.skipLockedATableAnotherSession"));
  if (has("tablespace"))
    lines.push(
      messageText("features.maintenance.locks.tablespaceTheIndexesBuiltAnewGo", {
        tablespace: String(o.tablespace),
      }),
    );
  lines.push(
    messageText("features.maintenance.locks.howLongDependsOnTheSize", {
      value: String(summaryOf(t, read.stats)),
    }),
  );
  lines.push(messageText("features.maintenance.locks.thePluginSendsItAloneOutside"));
  if (timeoutSeconds > 0)
    lines.push(
      messageText("features.maintenance.locks.theStatementTimeoutInTheSettings", {
        timeoutSeconds: String(timeoutSeconds),
      }),
    );
  return { heavy, lines };
}
