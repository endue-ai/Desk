// The audit list of what agents did on each connection (PG-91, ADR 0346), newest first, in the
// plugin's store under a key of its own, apart from the person's history: which caller, when, the
// command, the statement, the rows, whether the person was asked and allowed it, and how it ended.
// It is cut to 200 entries and 60 KiB a connection; a statement is cut at 2,000 characters, and
// one that looks like it carries a password keeps its first word only (history.js's test). Writes
// to one connection's list go one after another, so none is lost. No DOM.

import { baseOf } from "../../databases.js";
import { keepable } from "../../history.js";

/**
 * @typedef {"ran" | "failed" | "refused" | "declined" | "cancelled"} Outcome
 * @typedef {{
 *   at: string, caller: string, command: string, statement: string, rows: number | null,
 *   asked: boolean, allowed: boolean | null, outcome: Outcome, error?: string, database?: string,
 * }} Entry
 *   `allowed` is the person's answer when asked (null when nobody was asked); `rows` the rows read
 *   or changed (null when nothing ran).
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 */

export const AUDIT_MAX = 200;
export const AUDIT_BYTES = 60 * 1024;
const STATEMENT_MAX = 2000;
const ERROR_MAX = 300;

export const auditKey = (/** @type {string} */ connection) => `agent-audit:${baseOf(connection)}`;

/** A statement as the list keeps it. */
export function keptStatement(/** @type {string} */ text) {
  const line = text.trim();
  if (!keepable(line)) return `${line.split(/\s/u)[0] ?? ""} … (not kept: it may hold a password)`;
  return line.length > STATEMENT_MAX ? `${line.slice(0, STATEMENT_MAX - 1)}…` : line;
}

/** @param {Bridge} bridge */
export function createLog(bridge) {
  /** @type {Map<string, Promise<unknown>>} */
  const queue = new Map();
  const after = (/** @type {string} */ key, /** @type {() => Promise<unknown>} */ fn) => {
    const next = (queue.get(key) ?? Promise.resolve()).then(fn, fn);
    queue.set(key, next);
    return next;
  };

  /** @returns {Promise<Entry[]>} */
  const read = async (/** @type {string} */ connection) => {
    await queue.get(auditKey(connection))?.catch(() => {});
    const kept = await bridge.call("store.get", { key: auditKey(connection) }).catch(() => ({}));
    const value = /** @type {{ value?: unknown }} */ (kept).value;
    return Array.isArray(value) ? /** @type {Entry[]} */ (value) : [];
  };

  return {
    read,
    /** Put entries (oldest first) in front of the kept ones, within the limits. */
    add: (/** @type {string} */ connection, /** @type {Entry[]} */ entries) => {
      const key = auditKey(connection);
      const fresh = entries
        .map((e) => ({
          ...e,
          statement: keptStatement(e.statement),
          ...(e.error ? { error: e.error.slice(0, ERROR_MAX) } : {}),
        }))
        .reverse();
      return after(key, async () => {
        const old = await bridge.call("store.get", { key }).catch(() => ({}));
        const value = /** @type {{ value?: unknown }} */ (old).value;
        let list = [...fresh, ...(Array.isArray(value) ? value : [])].slice(0, AUDIT_MAX);
        while (list.length > 1 && JSON.stringify(list).length > AUDIT_BYTES)
          list = list.slice(0, -1);
        await bridge.call("store.set", { key, value: list }).catch(() => {});
      });
    },
    /** Empty a connection's list. */
    clear: (/** @type {string} */ connection) => {
      const key = auditKey(connection);
      return after(key, () => bridge.call("store.set", { key, value: [] }).catch(() => {}));
    },
  };
}
