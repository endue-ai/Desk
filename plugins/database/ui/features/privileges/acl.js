// An object's ACL as a matrix (PG-54): a row per grantee (the owner first, then PUBLIC, then by
// name) and per column a grantee holds column grants on, a cell per privilege that is none, granted
// or granted with its grant option, with every grantor and whether each gave the option. The
// person's edits are wanted states by cell; `changesOf` answers each cell whose wanted state is
// not the one read. Default privileges use the same matrix. Pure.

import { COLUMN_PRIVILEGES } from "./kinds.js";

/**
 * @typedef {"none" | "granted" | "option"} CellState
 * @typedef {{ grantee: string, column: string, privilege: string, grantable: boolean, grantor: string }} Entry
 * @typedef {{ state: CellState, grantors: { name: string, option: boolean }[] }} Cell
 * @typedef {{ grantee: string, column: string, cells: Record<string, Cell> }} MatrixRow
 * @typedef {{ privileges: string[], rows: MatrixRow[] }} Matrix
 * @typedef {{ grantee: string, column: string, privilege: string, from: CellState, to: CellState }} Change
 */

const SEP = "\u0000";

/** The key of one cell's edit. */
export const editKey = (
  /** @type {string} */ grantee,
  /** @type {string} */ column,
  /** @type {string} */ privilege,
) => [grantee, column, privilege].join(SEP);

/** A cell's next state when the person presses it: none, granted, with its grant option. */
export const nextState = (/** @type {CellState} */ state) =>
  /** @type {CellState} */ (state === "none" ? "granted" : state === "granted" ? "option" : "none");

/** The privileges of a matrix row: a column's are the four a column takes. */
export const rowPrivileges = (/** @type {Matrix} */ matrix, /** @type {MatrixRow} */ row) =>
  row.column ? matrix.privileges.filter((p) => COLUMN_PRIVILEGES.includes(p)) : matrix.privileges;

/**
 * The matrix of ACL entries, with `extra` grantees (added by the person) as empty rows.
 * @param {Entry[]} entries
 * @param {string[]} privileges
 * @param {string} owner
 * @param {{ grantee: string, column: string }[]} [extra]
 * @returns {Matrix}
 */
export function matrixOf(entries, privileges, owner, extra = []) {
  /** @type {Map<string, MatrixRow>} */
  const rows = new Map();
  const rowOf = (/** @type {string} */ grantee, /** @type {string} */ column) => {
    const key = `${grantee}${SEP}${column}`;
    let row = rows.get(key);
    if (!row) {
      row = { grantee, column, cells: {} };
      for (const p of column ? privileges.filter((x) => COLUMN_PRIVILEGES.includes(x)) : privileges)
        row.cells[p] = { state: "none", grantors: [] };
      rows.set(key, row);
    }
    return row;
  };
  for (const e of entries) {
    const cell = rowOf(e.grantee, e.column).cells[e.privilege];
    if (!cell) continue;
    cell.grantors.push({ name: e.grantor, option: e.grantable });
    if (e.grantable) cell.state = "option";
    else if (cell.state === "none") cell.state = "granted";
  }
  for (const x of extra) rowOf(x.grantee, x.column);
  const rank = (/** @type {MatrixRow} */ r) =>
    r.grantee === owner ? 0 : r.grantee === "PUBLIC" ? 1 : 2;
  const sorted = [...rows.values()].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.grantee.localeCompare(b.grantee) ||
      (a.column === "" ? -1 : b.column === "" ? 1 : a.column.localeCompare(b.column)),
  );
  return { privileges, rows: sorted };
}

/**
 * Each cell the person changed, in the matrix's order.
 * @param {Matrix} matrix
 * @param {Record<string, CellState>} edits
 * @returns {Change[]}
 */
export function changesOf(matrix, edits) {
  /** @type {Change[]} */
  const changes = [];
  for (const row of matrix.rows)
    for (const privilege of rowPrivileges(matrix, row)) {
      const from = row.cells[privilege]?.state ?? "none";
      const to = edits[editKey(row.grantee, row.column, privilege)];
      if (to && to !== from)
        changes.push({ grantee: row.grantee, column: row.column, privilege, from, to });
    }
  return changes;
}

/** A cell's state as the person sees it: the edit when there is one. */
export function shownState(
  /** @type {MatrixRow} */ row,
  /** @type {string} */ privilege,
  /** @type {Record<string, CellState>} */ edits,
) {
  return (
    edits[editKey(row.grantee, row.column, privilege)] ?? row.cells[privilege]?.state ?? "none"
  );
}

/**
 * Grants a revoke takes along: what the grantee gave others of the same privilege with its grant
 * option (a plain REVOKE is refused for them; CASCADE takes them too).
 * @param {Entry[]} entries
 * @param {Change[]} changes
 */
export function dependentGrants(entries, changes) {
  const lost = changes.filter((c) => c.from === "option" && c.to !== "option");
  return entries.filter((e) =>
    lost.some(
      (c) => c.grantee === e.grantor && c.privilege === e.privilege && c.column === e.column,
    ),
  );
}

/**
 * Revokes that leave another grantor's grant in place: a REVOKE takes only what the role running it
 * (or, for a superuser, the owner) granted.
 * @param {Matrix} matrix
 * @param {Change[]} changes
 * @param {string[]} as Who the statement revokes as: the user, and the owner for a superuser.
 */
export function othersGrants(matrix, changes, as) {
  /** @type {string[]} */
  const said = [];
  for (const c of changes) {
    if (c.to === "option" || (c.to === "granted" && c.from !== "option")) continue;
    const row = matrix.rows.find((r) => r.grantee === c.grantee && r.column === c.column);
    const others = (row?.cells[c.privilege]?.grantors ?? []).filter((g) => !as.includes(g.name));
    for (const g of others) said.push(`${c.privilege} to ${c.grantee} granted by ${g.name}`);
  }
  return [...new Set(said)];
}
