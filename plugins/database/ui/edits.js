// The grid's pending changes on the result shown (DB-14, ADR 0115): the first edit finds the table
// the rows come from (a table's view, or a console's plain SELECT of one table), reads its columns
// for the primary key and the types, and either keeps the changes or says why it cannot. Submit
// runs them in one transaction and reads the rows again; Revert drops them. A new run of the
// console starts a new result, so its changes are asked about first. No DOM.

import { defaultSchema } from "./catalog.js";
import {
  addRow,
  countChanges,
  deleteRows,
  editCell,
  emptyChanges,
  refusalOf,
  revertRows,
  targetOf,
} from "./edit/pending.js";
import { sourceOf } from "./edit/source.js";
import { previewSql, submitChanges } from "./edit/submit.js";
import { engineOf } from "./engines/index.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./engines/common.js").ResultSet} ResultSet
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {import("./edit/pending.js").Target} Target
 * @typedef {import("./edit/pending.js").Changes} Changes
 * @typedef {{
 *   key: string, status: "ready" | "refused", reason: string, target: Target | null,
 *   changes: Changes, count: number, message: string,
 * }} EditState
 *   `key` names the run and tab the changes are of; `message` is how the last submit went.
 * @typedef {{
 *   catalog: Pick<ReturnType<typeof import("./catalog.js").createCatalog>, "columns">,
 *   execute: import("./catalog.js").Execute,
 *   render(): void,
 *   reload(target: Console, conn: Connection): Promise<unknown>,
 * }} Deps
 */

/** The run and tab a console shows, as the key its changes belong to. */
const keyOf = (/** @type {Console} */ target) => `${target.execution?.at ?? 0}:${target.tab}`;

/** The result set on screen. */
export function shownSet(/** @type {Console} */ target) {
  return target.shown?.tabs[target.tab]?.set;
}

/** @param {Deps} deps */
export function createEdits(deps) {
  /**
   * The edit state of the result on screen, found the first time it is asked for.
   * @param {Console} target
   * @param {Connection} conn
   * @returns {Promise<EditState>}
   */
  const ensure = async (target, conn) => {
    const key = keyOf(target);
    if (target.edit?.key === key) return target.edit;
    const set = shownSet(target);
    const refused = (/** @type {string} */ reason) => ({
      key,
      status: /** @type {const} */ ("refused"),
      reason,
      target: null,
      changes: emptyChanges(),
      count: 0,
      message: "",
    });
    /** @type {EditState} */
    let state;
    if (!set) state = refused("Pick a result with rows first.");
    else if (conn.readOnly) state = refused(refusalOf(conn, undefined));
    else {
      const { dialect } = engineOf(conn.engine);
      const tab = target.shown?.tabs[target.tab];
      const statement = target.execution?.statements[tab?.statement ?? 0];
      const source =
        target.kind === "table" && target.table
          ? { schema: target.table.schema, name: target.table.name }
          : statement && target.execution?.statements.length === 1
            ? sourceOf(statement, dialect)
            : undefined;
      if (!source) state = refused(refusalOf(conn, undefined));
      else {
        const schema = source.schema ?? defaultSchema(conn);
        const columns = await deps.catalog.columns(conn, schema, source.name);
        if (columns.length === 0) state = refused(`No table ${source.name} was found to change.`);
        else {
          const found = targetOf(dialect, { schema, name: source.name }, set.columns, columns);
          const reason = refusalOf(conn, found.target, found.reason);
          state = reason
            ? refused(reason)
            : { ...refused(""), status: "ready", target: found.target ?? null };
        }
      }
    }
    target.edit = state;
    return state;
  };

  /**
   * Apply a change to the result on screen, or throw why it cannot be made.
   * @param {Console} target
   * @param {Connection} conn
   * @param {(state: EditState & { target: Target }, set: ResultSet) => unknown} change
   */
  const change = async (target, conn, change) => {
    const state = await ensure(target, conn);
    const set = shownSet(target);
    if (state.status !== "ready" || !state.target || !set) throw new Error(state.reason);
    const answer = change(/** @type {EditState & { target: Target }} */ (state), set);
    state.count = countChanges(state.changes);
    state.message = "";
    deps.render();
    return answer;
  };

  return {
    ensure,
    /** Whether the result on screen holds changes not submitted. */
    pending: (/** @type {Console} */ target) => (target.edit?.count ?? 0) > 0,
    editCell: (
      target,
      conn,
      /** @type {number} */ row,
      /** @type {number} */ col,
      /** @type {string | null} */ value,
    ) =>
      change(target, conn, (state, set) =>
        editCell(state.changes, state.target, set, row, col, value),
      ),
    addRow: (/** @type {Console} */ target, /** @type {Connection} */ conn) =>
      change(target, conn, (state, set) => addRow(state.changes, state.target, set)),
    deleteRows: (target, conn, /** @type {number[]} */ rows) =>
      change(target, conn, (state, set) => deleteRows(state.changes, state.target, set, rows)),
    /** Drop the changes of some rows, or all of them. */
    revert(/** @type {Console} */ target, /** @type {number[] | undefined} */ rows) {
      const set = shownSet(target);
      if (!target.edit || !set) return 0;
      const before = target.edit.count;
      revertRows(target.edit.changes, set, rows);
      target.edit.count = countChanges(target.edit.changes);
      target.edit.message = "";
      deps.render();
      return before - target.edit.count;
    },
    /** The statements a submit would run. */
    preview(/** @type {Console} */ target) {
      const set = shownSet(target);
      if (!target.edit?.target || !set || target.edit.count === 0)
        throw new Error("No pending changes.");
      return previewSql(target.edit.target, set, target.edit.changes);
    },
    /** Run the changes in one transaction; on success read the rows again. */
    async submit(/** @type {Console} */ target, /** @type {Connection} */ conn) {
      const state = target.edit;
      const set = shownSet(target);
      if (!state?.target || !set || state.count === 0)
        throw new Error("No pending changes to submit.");
      const done = await submitChanges({
        execute: deps.execute,
        conn,
        target: state.target,
        set,
        changes: state.changes,
      });
      if (!done.ok) {
        state.message = done.message;
        deps.render();
        throw new Error(done.message);
      }
      state.changes = emptyChanges();
      state.count = 0;
      await deps.reload(target, conn);
      if (target.edit && target.edit !== state) target.edit.message = done.message;
      deps.render();
      return done.message;
    },
  };
}
