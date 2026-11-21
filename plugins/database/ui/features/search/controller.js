// The search panels' controller: one panel per connection, opened from the palette, an agent or the
// explorer's `f` (a schema or a table chosen already), with the person's options and the estimate;
// a search at a time per panel, the panel drawn again after each table; Cancel; a hit opened as the
// table's view filtered to its row. A production connection asks first with what it will read,
// whoever asks; a read-only one searches, as a search only reads. index.js's commands and actions
// call it. No DOM.

import { formatCount } from "../../format.js";
import { answerOf, defaults, optionsOf, summaryText } from "./model.js";
import { candidatesOf, estimateOf, estimateText } from "./plan.js";
import { createRunner } from "./runner.js";
import { rowFilter } from "./sql.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./model.js").Options} Options
 * @typedef {import("./model.js").Run} Run
 * @typedef {{
 *   conn: { name: string, engine: string, readOnly: boolean, tag: string },
 *   schemas: string[], options: Options, estimate: string, run: Run | null, error: string,
 * }} SearchState
 *   `schemas` the connection's, to choose from; `estimate` the sentence said before a search.
 */

export const TYPE = "search";

const about = (/** @type {Connection} */ c) => ({
  name: c.name,
  engine: c.engine,
  readOnly: c.readOnly,
  tag: c.tag,
});
const words = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

/** @param {Deps} deps */
export function createSearchPanels(deps) {
  const runner = createRunner({ execute: deps.execute, columns: deps.catalog.columns });
  /** The search going on in each panel, by its id. @type {Map<string, AbortController>} */
  const running = new Map();
  const panels = () => deps.consoles.list().filter((b) => b.kind === TYPE);
  const panelOf = (/** @type {string} */ id) => panels().find((b) => b.id === id);
  const stateOf = (/** @type {string} */ id) =>
    /** @type {SearchState | undefined} */ (panelOf(id)?.[TYPE]);
  const update = (/** @type {string} */ id, /** @type {Partial<SearchState>} */ patch) => {
    const now = stateOf(id);
    if (now) deps.consoles.updatePanel(id, { ...now, ...patch });
  };
  const connOf = (/** @type {string} */ id) => {
    const found = panelOf(id);
    const conn = found ? deps.manager.get(found.connection) : undefined;
    if (!conn) throw new Error("This search's connection was removed.");
    return conn;
  };

  /** The options, the tables they read and the sentence about them. */
  const plan = async (/** @type {Connection} */ conn, /** @type {Options} */ options) => {
    const candidates = await candidatesOf(deps.catalog, conn, options, true);
    const estimate = estimateOf(candidates, options);
    return { estimate, text: estimateText(estimate, options) };
  };

  /** Open (or show again) a connection's search; `value` among the fields searches at once. */
  const open = async (/** @type {Record<string, unknown>} */ args) => {
    const ref = typeof args.connection === "string" && args.connection ? args.connection : "";
    const shown = deps.consoles.current();
    const conn =
      (!ref && shown ? deps.manager.get(shown.connection) : undefined) ??
      (await deps.manager.choose(
        ref || undefined,
        "Database: search for a value on which connection?",
      ));
    if (!conn) return undefined;
    const listed = await deps.catalog.schemas(conn, true);
    const name = `${TYPE}: ${conn.name}`;
    const kept = panels().find((b) => b.connection === conn.id && b.name === name)?.[TYPE];
    // A search asked with its value (an agent's) starts from the defaults, never from what the
    // panel was left with; the form opened again keeps the person's options.
    const direct = typeof args.value === "string" && args.value !== "";
    /** @type {Options} */
    const base = (!direct && kept?.options) || { ...defaults(), schemas: listed };
    const fields = { ...args };
    if (typeof args.schema === "string") fields.schemas = [args.schema];
    if (typeof args.table === "string") fields.tables = args.table;
    else if (typeof args.schema === "string" && args.tables === undefined) fields.tables = "";
    const options = optionsOf(fields, base);
    const known = options.schemas.filter((s) => listed.includes(s));
    const chosen = { ...options, schemas: known.length ? known : listed };
    const { text } = await plan(conn, chosen);
    /** @type {SearchState} */
    const state = {
      conn: about(conn),
      schemas: listed,
      options: chosen,
      estimate: text,
      run: kept?.run ?? null,
      error: "",
    };
    const panel = await deps.consoles.openPanel(conn, TYPE, name, state);
    if (!direct) {
      deps.say(text);
      return { estimate: text };
    }
    return answerOf(await start(panel.id, {}));
  };

  /** The form changed: keep its options and say again what a search would read. */
  const change = async (
    /** @type {string} */ id,
    /** @type {Record<string, unknown>} */ fields,
  ) => {
    const now = stateOf(id);
    if (!now) return;
    const conn = connOf(id);
    const options = optionsOf(fields, now.options);
    update(id, { options, estimate: (await plan(conn, options)).text });
  };

  /**
   * Search with the panel's options (and the fields given); resolves with the run once it ends.
   * @param {string} id
   * @param {Record<string, unknown>} fields
   * @returns {Promise<Run>}
   */
  const start = async (id, fields) => {
    const now = stateOf(id);
    if (!now) throw new Error("No search panel is open.");
    if (running.has(id)) throw new Error("A search is going on: cancel it first.");
    const conn = connOf(id);
    const options = optionsOf(fields, now.options);
    if (options.value === "") throw new Error("Type the value to find first.");
    if (options.families.length === 0) throw new Error("Pick at least one kind of column.");
    const control = new AbortController();
    running.set(id, control);
    try {
      const { estimate, text } = await plan(conn, options);
      update(id, { options, estimate: text, error: "" });
      if (estimate.search.length === 0) throw new Error(text);
      if (conn.tag === "production") {
        const tables = estimate.search.length;
        const ok = await deps.confirm(
          `Search ${formatCount(tables)} ${tables === 1 ? "table" : "tables"} on ${conn.name}?`,
          [`${conn.name} is tagged production.`, text],
        );
        if (!ok) throw deps.cancelled("Not searched.");
      }
      const run = await runner.run(conn, estimate, options, {
        signal: control.signal,
        progress: (next) => update(id, { run: next }),
      });
      deps.say(run.phase === "failed" ? `Not searched: ${run.error}` : summaryText(run));
      return run;
    } catch (error) {
      if (/** @type {{ code?: string }} */ (error)?.code !== "cancelled")
        update(id, { error: words(error) });
      throw error;
    } finally {
      running.delete(id);
    }
  };

  /** Stop a panel's search: the statement running now and every table after it. */
  const cancel = (/** @type {string | undefined} */ id) => {
    const shown = deps.consoles.current();
    const target = id ?? (shown?.kind === TYPE ? shown.id : [...running.keys()].at(-1));
    const control = target ? running.get(target) : undefined;
    if (!control) throw new Error("No search is going on.");
    control.abort();
    return { cancelled: true };
  };

  /**
   * Open a table of the results, filtered to a column's matches or to one hit's row.
   * @param {string} id
   * @param {number} t the table's index in the results
   * @param {number} c the column's index in that table
   * @param {number} [h] the hit's index in that column
   */
  const openHit = async (id, t, c, h) => {
    const table = stateOf(id)?.run?.tables[t];
    const column = table?.columns[c];
    if (!table || !column) throw new Error("That result is gone: search again.");
    const conn = connOf(id);
    const hit = h === undefined ? undefined : column.hits[h];
    const where = hit ? rowFilter(conn.engine, table.key, hit.key, column.where) : column.where;
    await deps.consoles.open(conn, { schema: table.schema, name: table.name });
    await deps.consoles.page({ where });
    deps.view.focus("grid");
    const said = !hit
      ? `${table.name}: the rows whose ${column.name} matches.`
      : table.key.by === "ctid"
        ? `${table.name} has no primary key: its row is found by its ctid, which an update or VACUUM FULL moves.`
        : table.key.by === "rowid"
          ? `${table.name} has no primary key: its row is found by its rowid.`
          : table.key.by === "match"
            ? `${table.name} has no primary key: these are the rows whose ${column.name} matches.`
            : `${table.name}: the row of ${table.key.columns.join(", ")} ${hit.key.join(", ")}.`;
    deps.say(said);
    return { where };
  };

  return { open, change, start, cancel, openHit };
}
