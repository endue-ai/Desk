// What the console does with a read its cursor keeps (PG-22, ADR 0352, rows/window.js): the next
// or previous page as the grid scrolls (one request at a time per console), Count every row (the
// cursor moved to its end), Fetch every row (up to ALL_MAX, after which the result is whole and
// sorts in the frame), and the grid's sort keys and quick filters put into the statement, which runs
// again with ORDER BY and WHERE around it, since sorting a result not fully read needs every row.
// A fetch that fails leaves the rows held and says the rest cannot be read. No DOM.

import { engineOf } from "../engines/index.js";
import { formatCount } from "../format.js";
import { orderSql, whereWith } from "../grid/filters.js";
import { ownerOf } from "../session/owners.js";
import { split } from "../sql/split.js";
import { askFor, counted, lost, placed, whole } from "./window.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("../consoles.js").Console} Console
 * @typedef {import("./window.js").Way} Way
 * @typedef {import("../grid/filters.js").SortKey} SortKey
 * @typedef {import("../grid/filters.js").Filter} Filter
 * @typedef {{
 *   sessions?: Pick<ReturnType<typeof import("../engines/pg-session.js").createSessions>, "rows">,
 *   settings(): import("../settings.js").Settings,
 *   run(target: Console, conn: Connection, sql: string, options: { history?: boolean, statements?: import("../sql/split.js").Statement[] }): Promise<string>,
 *   render(): void, say?(text: string): void,
 * }} Deps
 */

/** The most rows Fetch every row holds. */
export const ALL_MAX = 100_000;
const ALL_PAGE = 10_000;

/** The set of a console's result its cursor keeps, if any. */
export function windowed(/** @type {Console} */ target) {
  return target.execution?.result.statements[0]?.sets.find((set) => set.window);
}

/** The statement with the grid's keys and filters around it; `base` as it is without either. */
export function shapedSql(
  /** @type {string} */ base,
  /** @type {import("../sql/lexer.js").Dialect} */ dialect,
  /** @type {SortKey[]} */ sort,
  /** @type {Filter[]} */ filters,
) {
  const where = whereWith(dialect, "", filters);
  const order = orderSql(dialect, sort);
  if (!where && !order) return base;
  const inner = base.trim().replace(/;\s*$/u, "");
  return `SELECT * FROM (\n${inner}\n) AS endue_rows${where ? `\nWHERE ${where}` : ""}${order ? `\nORDER BY ${order}` : ""}`;
}

/** @param {Deps} deps */
export function createRowsControl(deps) {
  /** @type {WeakMap<Console, Promise<string>>} */
  const busy = new WeakMap();

  /** Put `next` where `old` was: in the run's outcome and in every tab that shows it. */
  const swap = (
    /** @type {Console} */ target,
    /** @type {ResultSet} */ old,
    /** @type {ResultSet} */ next,
  ) => {
    const outcome = target.execution?.result.statements[0];
    if (outcome) outcome.sets = outcome.sets.map((s) => (s === old ? next : s));
    for (const tab of target.shown?.tabs ?? []) if (tab.set === old) tab.set = next;
    deps.render();
  };
  const owner = (/** @type {Console} */ target, /** @type {Connection} */ conn) => {
    const who = ownerOf(target, conn);
    if (!who || !deps.sessions)
      throw new Error("Only a PostgreSQL console's read keeps its rows on the server.");
    return who;
  };
  const timeout = () => deps.settings().timeoutSeconds * 1000;
  /** One request per console at a time: a second waits for the first's answer. */
  const once = (/** @type {Console} */ target, /** @type {() => Promise<string>} */ work) => {
    const going = busy.get(target);
    if (going) return going;
    const started = work().finally(() => busy.delete(target));
    busy.set(target, started);
    return started;
  };
  const held = (/** @type {Console} */ target) => {
    const set = windowed(target);
    if (!set?.window) throw new Error("This result holds every row it has.");
    if ((target.edit?.status === "ready" && target.edit.count) || 0)
      throw new Error("Submit or drop the pending changes before reading other rows.");
    return /** @type {ResultSet & { window: import("../engines/common.js").Window }} */ (set);
  };

  /** The next or previous page, as the grid scrolls; "" when there is none that way. */
  const scroll = (
    /** @type {Console} */ target,
    /** @type {Connection} */ conn,
    /** @type {Way} */ way,
  ) =>
    once(target, async () => {
      const set = held(target);
      const ask = askFor(set, way);
      if (!ask) return "";
      const got = await /** @type {NonNullable<Deps["sessions"]>} */ (deps.sessions).rows(
        conn,
        owner(target, conn),
        { id: set.window.id, ...ask },
        timeout(),
      );
      if ("error" in got) {
        swap(target, set, lost(set, "the rest cannot be read"));
        throw new Error(`The rows past those held cannot be read: ${got.error.message}`);
      }
      swap(target, set, placed(set, way, got));
      return "";
    });

  /** Count every row: the cursor goes to its end; the rows held stay. */
  const count = (/** @type {Console} */ target, /** @type {Connection} */ conn) =>
    once(target, async () => {
      const set = held(target);
      if (set.window.done) return `${formatCount(set.window.known)} rows`;
      const got = await /** @type {NonNullable<Deps["sessions"]>} */ (deps.sessions).rows(
        conn,
        owner(target, conn),
        { id: set.window.id, all: true },
        timeout(),
      );
      if ("error" in got) {
        swap(target, set, lost(set, "the rest cannot be read"));
        return `Not counted: ${got.error.message}`;
      }
      swap(target, set, counted(set, got.total ?? 0));
      return `${formatCount(got.total ?? 0)} rows`;
    });

  /** Fetch every row, up to ALL_MAX: the result is then whole and sorts and filters in the frame. */
  const all = (/** @type {Console} */ target, /** @type {Connection} */ conn) =>
    once(target, async () => {
      const set = held(target);
      if (whole(set)) return `Every row is held: ${formatCount(set.rows.length)}.`;
      if (set.window.done && set.window.known > ALL_MAX) return tooMany();
      const rows = [];
      for (let from = 0; ; from += ALL_PAGE) {
        const got = await /** @type {NonNullable<Deps["sessions"]>} */ (deps.sessions).rows(
          conn,
          owner(target, conn),
          { id: set.window.id, from, count: ALL_PAGE },
          timeout(),
        );
        if ("error" in got) return `Not fetched: ${got.error.message}`;
        rows.push(...got.rows);
        if (rows.length > ALL_MAX) return tooMany();
        if (got.done) break;
      }
      const window = { ...set.window, first: 0, known: rows.length, done: true };
      swap(target, set, { ...set, rows, truncated: false, window });
      return `Fetched every row: ${formatCount(rows.length)}.`;
    });

  /**
   * The grid's sort keys or quick filters on a result not fully read: put into the statement,
   * which runs again so the server sorts and filters every row.
   * @param {Console} target @param {Connection} conn @param {{ sort?: SortKey[] | null, filters?: Filter[] }} change
   */
  const shape = async (target, conn, change) => {
    const set = held(target);
    const w = set.window;
    const base = w.base ?? target.execution?.statements[0]?.text ?? "";
    const sort = change.sort === undefined ? (w.sort ?? []) : (change.sort ?? []);
    const filters = change.filters ?? w.filters ?? [];
    const { dialect } = engineOf(conn.engine);
    const sql = shapedSql(base, dialect, sort, filters);
    const statements = split(sql, dialect);
    await deps.run(target, conn, sql, { history: false, statements });
    const next = windowed(target);
    if (next?.window)
      swap(target, next, { ...next, window: { ...next.window, base, sort, filters } });
    const what = change.filters !== undefined ? "Filtering" : "Sorting";
    const said = `${what} needs every row, and this result was not fully read: the statement ran again with ${change.filters !== undefined ? "WHERE" : "ORDER BY"} around it, on the server. Fetch every row to ${what.toLowerCase().replace("ing", "")} here instead.`;
    deps.say?.(said);
    return said;
  };

  return { scroll, count, all, shape };
}

const tooMany = () =>
  `More than ${formatCount(ALL_MAX)} rows: put ORDER BY or WHERE into the statement instead, or export it.`;
