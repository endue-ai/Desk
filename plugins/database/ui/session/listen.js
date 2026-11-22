// What a console's PostgreSQL session listens to and has heard (PG-25, ADR 0358). The channels are
// read from the statements the console ran: LISTEN adds one, UNLISTEN takes one or all (`*`), and
// DISCARD ALL takes all; inside a transaction they wait for its COMMIT and are dropped at its
// ROLLBACK, when it failed, and in a dry run, as the server does. The plugin runs nothing of its own
// to learn them: a LISTEN inside a function is not seen, though what it hears is. A console keeps
// its latest KEEP notifications, counts what it dropped and what the person has not seen. A
// session that ends stops listening: its channels are kept as `stopped`, to be offered again, and
// nothing listens again on its own. No DOM.

import { tokenize } from "../sql/lexer.js";

/**
 * @typedef {import("../sql/split.js").Statement} Statement
 * @typedef {import("../engines/common.js").RunResult} RunResult
 * @typedef {import("@endue-ai/bridge").DbTransaction} Transaction
 * @typedef {{ at: number, channel: string, payload: string, pid: number }} Heard
 * @typedef {{ op: "listen" | "unlisten", channel: string } | { op: "all" }} Op
 *   `all` is UNLISTEN * and DISCARD ALL.
 * @typedef {{
 *   channels: Set<string>, pending: Op[], heard: Heard[], dropped: number, unseen: number,
 *   stopped: string[],
 * }} Listening
 *   `pending` waits for its transaction's COMMIT; `stopped` the channels a session that ended
 *   listened to.
 */

/** The notifications a console keeps; older ones are dropped and counted. */
export const KEEP = 1000;

/** The words and names of a statement, comments and spaces left out. */
const significant = (/** @type {Statement} */ statement) =>
  (statement.tokens?.length ? statement.tokens : tokenize(statement.text, "postgresql")).filter(
    (t) => t.type !== "space" && t.type !== "comment",
  );

/** A channel as the server names it: an unquoted one in lower case, a quoted one as written. */
const channelOf = (/** @type {{ type: string, text: string } | undefined} */ token) => {
  if (token?.type === "name") return token.text.slice(1, -1).replaceAll('""', '"');
  return token?.type === "word" ? token.text.toLowerCase() : "";
};

/** What a statement does to the channels, or to the transaction they wait in. */
export function actOf(/** @type {Statement} */ statement) {
  const [first, second] = significant(statement);
  const verb = first?.type === "word" ? first.text.toUpperCase() : "";
  const next = second?.text.toUpperCase() ?? "";
  if (verb === "LISTEN" && channelOf(second)) return { op: "listen", channel: channelOf(second) };
  if (verb === "UNLISTEN" && next === "*") return { op: "all" };
  if (verb === "UNLISTEN" && channelOf(second))
    return { op: "unlisten", channel: channelOf(second) };
  if (verb === "DISCARD" && next === "ALL") return { op: "all" };
  if (verb === "BEGIN" || (verb === "START" && next === "TRANSACTION")) return { op: "begin" };
  if (verb === "COMMIT" || verb === "END") return { op: "commit" };
  if ((verb === "ROLLBACK" || verb === "ABORT") && next !== "TO") return { op: "rollback" };
  return undefined;
}

/** Whether a statement listens or stops listening (what an agent's run may not hold). */
export const listens = (/** @type {Statement} */ statement) => {
  const op = actOf(statement)?.op;
  return (
    op === "listen" || op === "unlisten" || (op === "all" && /^\s*UNLISTEN/iu.test(statement.text))
  );
};

/** @param {{ now(): number }} deps */
export function createListening(deps) {
  /** @type {Map<string, Listening>} */
  const all = new Map();
  const of = (/** @type {string} */ owner) => {
    let found = all.get(owner);
    if (!found) {
      found = { channels: new Set(), pending: [], heard: [], dropped: 0, unseen: 0, stopped: [] };
      all.set(owner, found);
    }
    return found;
  };
  const apply = (/** @type {Listening} */ l, /** @type {Op} */ op) => {
    if (op.op === "all") l.channels.clear();
    else if (op.op === "listen") l.channels.add(op.channel);
    else l.channels.delete(op.channel);
    if (l.channels.size) l.stopped = [];
  };

  return {
    /**
     * The statements a run on the owner's session ran, in its mode, its transaction `before`.
     * @param {string} owner @param {Statement[]} statements @param {RunResult} result
     * @param {"run" | "transaction" | "dry-run"} mode @param {Transaction} before
     */
    ran(owner, statements, result, mode, before) {
      const l = of(owner);
      let inside = before !== "idle" || mode !== "run";
      let failed = before === "failed";
      /** The ops of a run in one transaction, or a dry run: they wait for its end. */
      const own = /** @type {Op[]} */ ([]);
      const waiting = mode === "run" ? l.pending : own;
      for (const [i, outcome] of result.statements.entries()) {
        const statement = statements[i];
        if (!outcome.ran || !statement) continue;
        if (outcome.error) {
          if (inside) failed = true;
          continue;
        }
        const act = actOf(statement);
        if (!act) continue;
        if (act.op === "begin") {
          inside = true;
          failed = false;
        } else if (act.op === "commit" || act.op === "rollback") {
          const kept = act.op === "commit" && !failed;
          for (const op of waiting.splice(0)) if (kept) apply(l, op);
          inside = mode !== "run";
          failed = false;
        } else if (inside) waiting.push(act);
        else apply(l, act);
      }
      // A run in one transaction commits at its end, or under a savepoint of the open one; a dry
      // run rolls back.
      const committed = mode === "transaction" && !failed && !result.error;
      for (const op of committed ? own : []) {
        if (before === "idle") apply(l, op);
        else l.pending.push(op);
      }
    },
    /** A notification the owner's session heard. */
    heard(/** @type {string} */ owner, /** @type {Omit<Heard, "at">} */ n) {
      const l = of(owner);
      l.heard.push({ at: deps.now(), ...n });
      l.unseen++;
      if (l.heard.length > KEEP) {
        const over = l.heard.length - KEEP;
        l.heard.splice(0, over);
        l.dropped += over;
      }
    },
    /** The owner's session ended: what it listened to stopped. The channels that did. */
    ended(/** @type {string} */ owner) {
      const l = all.get(owner);
      if (!l) return [];
      if (l.channels.size) l.stopped = [...l.channels];
      l.channels.clear();
      l.pending = [];
      return l.stopped;
    },
    /** The person read them: the badge goes. */
    seen(/** @type {string} */ owner) {
      const l = all.get(owner);
      if (l) l.unseen = 0;
    },
    /** Clear the list, and what it dropped. */
    clear(/** @type {string} */ owner) {
      const l = all.get(owner);
      if (l) Object.assign(l, { heard: [], dropped: 0, unseen: 0 });
    },
    /** An owner that is gone. */
    forget: (/** @type {string} */ owner) => all.delete(owner),
    /** Whether the owner's session listens: the idle timer leaves it open. */
    listening: (/** @type {string} */ owner) => (all.get(owner)?.channels.size ?? 0) > 0,
    /** What the Notifications tab shows; undefined while there is nothing to show. */
    model(/** @type {string} */ owner) {
      const l = all.get(owner);
      if (!l || (!l.channels.size && !l.heard.length && !l.stopped.length && !l.dropped))
        return undefined;
      return { ...l, channels: [...l.channels].sort() };
    },
  };
}
