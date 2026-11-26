// A block of values onto the pending changes (PG-43, ADR 0115): a paste, a fill down or a clear, as a
// plan made first and applied after. Each value lands from the block's top-left cell, down the rows
// in their order on screen and right over the shown columns (hidden ones skipped); rows past the
// last are added as pending rows; one value goes into every cell of a selected block. Each value is
// read by its column's type (cell-editors/values.js, PG-40). A plan with a bad value is refused
// whole, naming the row and the column, before anything changes. Pure.

import { checkValue } from "../cell-editors/values.js";
import { t } from "../strings/index.js";
import { addRow, cellAt, editCell } from "./pending.js";
import { isDefault } from "./values.js";

/**
 * @typedef {import("./pending.js").Target} Target
 * @typedef {import("./pending.js").Changes} Changes
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {{ order: number[], columns: number[], top: number, bottom: number, left: number, right: number }} At
 *   Where on screen: the result rows in screen order (the pending rows last), the shown result
 *   columns in screen order, and the selected block's corners in screen rows and columns.
 * @typedef {{ row: number, col: number, value: string | null }} Planned A result cell, its value.
 * @typedef {{ row: string, column: string, reason: string }} Bad Where a value is refused, and why.
 * @typedef {{
 *   cells: Planned[], added: number, rows: number, width: number, header: boolean,
 *   bad: Bad[], refused: number, wide: string, inserts: number,
 * }} Plan
 *   `added`: rows past the last; `rows` and `width`: the block of values; `header`: the first line
 *   named the columns and was left out; `bad`: the first refusals, `refused` how many in all;
 *   `wide`: why the values do not fit the columns on screen; `inserts`: the pending rows planned on.
 */

/** A paste of more cells than this asks first. */
export const PASTE_ASK = 1000;
const KEEP_BAD = 100;

const fold = (/** @type {string | null | undefined} */ s) => (s ?? "").trim().toLowerCase();

/**
 * What a column takes for a value, or why it refuses it: a column of no table, a fixed one, NULL in
 * a NOT NULL one, and what its type refuses. An empty value in a typed column (not text) is NULL.
 * @param {Target} target
 * @param {number} col
 * @param {string | null} value
 * @param {boolean} inserting
 * @returns {{ value: string | null } | { error: string }}
 */
function valueFor(target, col, value, inserting) {
  const column = target.columns[col];
  const name = column?.name ?? "This column";
  if (!column?.known)
    return {
      error:
        column?.why ||
        t("edit.cells.isNotAColumnOfIt", { name: String(name), name2: String(target.name) }),
    };
  const editor = column.editor;
  if (editor?.fixed)
    return { error: t("edit.cells.hideTheColumnHToLeave", { fixed: String(editor.fixed) }) };
  if (isDefault(value)) {
    if (!inserting && target.dialect === "sqlite")
      return { error: t("edit.cells.sqliteCannotSetAColumnTo") };
    return { value };
  }
  const typed = value === "" && editor && editor.kind !== "text" ? null : value;
  if (typed === null)
    return editor?.nullable === false
      ? { error: t("edit.cells.isNotNullGiveItA", { name: String(name) }) }
      : { value: null };
  return editor ? checkValue(editor, typed) : { value: typed };
}

/** Why a result row takes no change, or "". */
function rowWhy(
  /** @type {Target} */ target,
  /** @type {ResultSet} */ set,
  /** @type {Changes} */ changes,
  /** @type {number} */ row,
) {
  if (row >= set.rows.length) return "";
  if (changes.deletes.has(row)) return t("edit.cells.theRowIsDeletedRestoreIt");
  const original = set.rows[row];
  const blank = target.key.find((c) => (original?.[c] ?? null) === null);
  if (blank === undefined) return "";
  return t("edit.cells.itsIsNullSoTheRow", {
    value: String(target.columns[blank]?.name ?? t("edit.cells.key")),
  });
}

/**
 * Where each value lands and what it becomes, or why it cannot.
 * @param {{ target: Target, set: ResultSet, changes: Changes, at: At, values: (string | null)[][], header?: boolean }} input
 *   `header` false: never read the first line as the columns' names (a fill).
 * @returns {Plan}
 */
export function planCells({ target, set, changes, at, values, header = true }) {
  /** @type {Plan} */
  const plan = {
    cells: [],
    added: 0,
    rows: 0,
    width: 0,
    header: false,
    bad: [],
    refused: 0,
    wide: "",
    inserts: changes.inserts.length,
  };
  const nameAt = (/** @type {number} */ c) => set.columns[at.columns[c] ?? -1];
  let grid = values;
  const first = values[0] ?? [];
  if (values.length === 1 && first.length === 1 && (at.bottom > at.top || at.right > at.left)) {
    const value = first[0] ?? null;
    const across = at.right - at.left + 1;
    grid = Array.from({ length: at.bottom - at.top + 1 }, () => Array(across).fill(value));
  } else if (header && values.length > 1 && first.length > 1) {
    const named = first.every((v, j) => {
      const name = nameAt(at.left + j);
      return name !== undefined && fold(v) === fold(name);
    });
    if (named) {
      grid = values.slice(1);
      plan.header = true;
    }
  }
  plan.rows = grid.length;
  plan.width = grid.reduce((most, line) => Math.max(most, line.length), 0);
  const room = at.columns.length - at.left;
  if (plan.width > room) {
    plan.wide = t("edit.cells.thePasteIsColumnsWideAnd", {
      width: String(plan.width),
      value: String(nameAt(at.left) ?? t("edit.cells.here")),
      room: String(room),
      value2: String(room === 1 ? t("edit.cells.is") : t("edit.cells.sAre")),
    });
    return plan;
  }
  const shown = at.order.length;
  grid.forEach((line, i) => {
    const r = at.top + i;
    const fresh = r >= shown;
    const row = fresh ? set.rows.length + changes.inserts.length + (r - shown) : (at.order[r] ?? 0);
    if (fresh) plan.added = Math.max(plan.added, r - shown + 1);
    const label = fresh
      ? t("edit.cells.newRow", { value: String(r - shown + 1) })
      : t("edit.cells.row", { value: String(r + 1) });
    const why = fresh ? "" : rowWhy(target, set, changes, row);
    line.forEach((value, j) => {
      const col = at.columns[at.left + j] ?? 0;
      const got = why ? { error: why } : valueFor(target, col, value, row >= set.rows.length);
      if ("value" in got) {
        plan.cells.push({ row, col, value: got.value });
        return;
      }
      plan.refused++;
      if (plan.bad.length < KEEP_BAD)
        plan.bad.push({ row: label, column: set.columns[col] ?? "", reason: got.error });
    });
  });
  return plan;
}

/** Why a plan is refused, as "Nothing <verb>: <row>, <column>: <why>", or "" when it is not. */
export function refusalOf(/** @type {Plan} */ plan, /** @type {string} */ verb) {
  if (plan.wide) return `Nothing ${verb}: ${plan.wide}`;
  const first = plan.bad[0];
  if (!first) return "";
  const more = plan.refused - 1;
  const rest = more
    ? t("edit.cells.moreCellRefusedToo", {
        more: String(more),
        value: String(more === 1 ? t("edit.cells.is") : t("edit.cells.sAre")),
      })
    : "";
  return `Nothing ${verb}: ${first.row}, ${first.column}: ${first.reason}${rest}`;
}

/**
 * Apply a plan that was not refused, on the pending rows it was made on.
 * @param {Changes} changes
 * @param {Target} target
 * @param {ResultSet} set
 * @param {Plan} plan
 */
export function applyCells(changes, target, set, plan) {
  const refused = refusalOf(plan, "changed");
  if (refused) throw new Error(refused);
  if (changes.inserts.length !== plan.inserts)
    throw new Error(t("edit.cells.thePendingRowsChangedMeanwhileNothing"));
  for (let i = 0; i < plan.added; i++) addRow(changes, target, set);
  for (const { row, col, value } of plan.cells) editCell(changes, target, set, row, col, value);
}

/**
 * The values of a fill down: the block's top row, for each row below it in the block.
 * @param {ResultSet} set
 * @param {Changes} changes
 * @param {At} at
 */
export function fillDownValues(set, changes, at) {
  if (at.bottom <= at.top) throw new Error(t("edit.cells.selectTwoRowsOrMoreTo"));
  const row = at.order[at.top] ?? 0;
  const top = [];
  for (let c = at.left; c <= at.right; c++)
    top.push(cellAt(changes, set, row, at.columns[c] ?? 0).value);
  const values = Array.from({ length: at.bottom - at.top }, () => [...top]);
  return { at: { ...at, top: at.top + 1 }, values, header: false };
}
