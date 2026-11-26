// The visible buffer as bounded data. A read neither runs SQL nor changes the current view.
import { shownSet } from "./edits.js";
import { engineOf } from "./engines/index.js";
import { leakOf, maskSet, namesOf } from "./features/audit/mask.js";
import { keepable } from "./history.js";

const PARTS = ["console", "result", "selection", "pending", "plan", "transaction"];
const TEXT_LIMIT = 16_000;
const CELL_LIMIT = 1_000;
const COLUMN_LIMIT = 128;

/**
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./explain/node.js").PlanNode} PlanNode
 */

/** Positions and operations describe pending changes without including table values. */
export function pendingOf(/** @type {Console} */ target) {
  const { edit } = target;
  if (!edit) return { count: 0, updates: [], deletes: [], inserts: 0 };
  return {
    count: edit.count,
    updates: [...edit.changes.updates.entries()].slice(0, 100).map(([row, cells]) => ({
      row,
      columns: [...cells.keys()].slice(0, COLUMN_LIMIT),
    })),
    deletes: [...edit.changes.deletes].slice(0, 100),
    inserts: edit.changes.inserts.length,
  };
}

function shownRows(
  /** @type {Console} */ target,
  /** @type {Connection} */ conn,
  /** @type {Set<string>} */ names,
  /** @type {number} */ maxRows,
) {
  const set = shownSet(target);
  if (!set) return null;
  const tab = target.shown?.tabs[target.tab];
  const sql = tab?.pin?.sql ?? target.execution?.statements[tab?.statement ?? -1]?.text;
  const dialect = engineOf(conn.engine).dialect;
  const hidden = sql ? !keepable(sql) || leakOf(sql, dialect, [set], names) : names.size > 0;
  const page = { ...set, rows: hidden ? [] : set.rows.slice(0, maxRows) };
  const { columns, rows } = maskSet(page, names);
  return {
    columns: columns.slice(0, COLUMN_LIMIT),
    rows: rows.map((row) =>
      row.slice(0, COLUMN_LIMIT).map((value) => value?.slice(0, CELL_LIMIT) ?? null),
    ),
    truncated: set.truncated || rows.length < set.rows.length || columns.length > COLUMN_LIMIT,
  };
}

/** The plan's structure and metrics. Predicates and raw server JSON stay in the UI. */
function planOf(/** @type {PlanNode | undefined} */ plan) {
  let left = 100;
  const visit = (/** @type {PlanNode} */ node, /** @type {number} */ depth) => {
    left -= 1;
    const { kind, cost, rows, actualRows, time, loops } = node;
    const children =
      depth < 12
        ? node.children.flatMap((child) => (left > 0 ? [visit(child, depth + 1)] : []))
        : [];
    return { kind, cost, rows, actualRows, time, loops, children };
  };
  return plan ? visit(plan, 0) : null;
}

/**
 * @param {Console} target
 * @param {Connection} conn
 * @param {Pick<import("./database.js").View, "editor" | "selection">} view
 * @param {unknown} include
 * @param {number} maxRows
 * @param {string[]} sensitive
 */
export function readView(target, conn, view, include, maxRows, sensitive) {
  const parts = new Set(Array.isArray(include) ? include : PARTS);
  const editor = target.kind === "console" ? view.editor() : undefined;
  const text = editor?.text ?? target.text;
  const names = namesOf(sensitive);
  const picked = parts.has("selection") ? view.selection() : undefined;
  const plan = target.shown?.tabs.find((tab) => tab.kind === "plan")?.plan;
  const session = target.session;
  return {
    ...(parts.has("console")
      ? {
          console: {
            id: target.id,
            connection: target.connection,
            kind: target.kind,
            sql: keepable(text) ? text.slice(0, TEXT_LIMIT) : null,
          },
        }
      : {}),
    ...(parts.has("result") ? { result: shownRows(target, conn, names, maxRows) } : {}),
    ...(parts.has("selection")
      ? {
          selection: {
            tab: picked?.tab ?? target.tab,
            rows: (picked?.rows ?? []).slice(0, maxRows),
            columns: (picked?.columns ?? []).slice(0, COLUMN_LIMIT),
            editor: editor ? { start: editor.start, end: editor.end } : null,
          },
        }
      : {}),
    ...(parts.has("pending") ? { pending: pendingOf(target) } : {}),
    ...(parts.has("plan") ? { plan: planOf(plan) } : {}),
    ...(parts.has("transaction")
      ? { transaction: session ? { state: session.state, label: session.label } : null }
      : {}),
  };
}
