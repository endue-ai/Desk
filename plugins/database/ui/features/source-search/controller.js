// The source search panels' controller (PG-82): one panel per connection, opened from the palette or
// an agent; a search at a time per panel over the scope's cached schemas, schema after schema: the
// items the cache holds (items.js), the bodies it does not, read once per read of the schema
// (read.js), matched in place or in the worker (matcher.js), the panel drawn again after each
// schema; Cancel stops the read in flight and every schema after it. A result opens its source (a
// routine's or a view's console, PG-52) or its DDL, at the line. Nothing here writes. No DOM.

import { bridgeStore } from "../../schema-cache/store.js";
import { openSource } from "../objects/source.js";
import { createSources } from "../palette/sources.js";
import { itemsOf, needOf } from "./items.js";
import { createMatcher } from "./matcher.js";
import { answerOf, defaults, fold, newRun, optionsOf, summaryText } from "./model.js";
import { heldFor, missing, readBodies } from "./read.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../schema-cache/view.js").CacheView} CacheView
 * @typedef {import("./model.js").Options} Options
 * @typedef {import("./model.js").Run} Run
 * @typedef {import("./model.js").Hit} Hit
 * @typedef {{
 *   conn: { name: string, engine: string, readOnly: boolean, tag: string },
 *   schemas: string[], options: Options, run: Run | null, error: string,
 * }} SourceState
 *   `schemas` the connection's held ones, to choose the one of the scope "schema" from.
 * @typedef {{ conn: Connection, view: CacheView, schema: string }} Step
 */

export const TYPE = "source-search";
const SOURCE_KINDS = new Set(["function", "procedure", "view", "materialized view"]);

const words = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));
const isCancel = (/** @type {unknown} */ e) =>
  /** @type {{ code?: string }} */ (e)?.code === "cancelled";

/** Where a line starts and ends in a text. */
export function lineRange(/** @type {string} */ text, /** @type {number} */ line) {
  let from = 0;
  for (let n = 1; n < line; n++) {
    const next = text.indexOf("\n", from);
    if (next < 0) break;
    from = next + 1;
  }
  const end = text.indexOf("\n", from);
  return { from, to: end < 0 ? text.length : end };
}

/** @param {Deps} deps */
export function createSourcePanels(deps) {
  const sources = createSources({
    connections: () => deps.manager.list(),
    view: (conn) => deps.catalog.cache.view(conn),
    store: bridgeStore(deps.bridge),
  });
  const now = () => Date.now();
  /** The search going on in each panel, by its id. @type {Map<string, AbortController>} */
  const running = new Map();
  const panels = () => deps.consoles.list().filter((b) => b.kind === TYPE);
  const panelOf = (/** @type {string} */ id) => panels().find((b) => b.id === id);
  const stateOf = (/** @type {string} */ id) =>
    /** @type {SourceState | undefined} */ (panelOf(id)?.[TYPE]);
  const update = (/** @type {string} */ id, /** @type {Partial<SourceState>} */ patch) => {
    const state = stateOf(id);
    if (state) deps.consoles.updatePanel(id, { ...state, ...patch });
  };
  const connOf = (/** @type {string} */ id) => {
    const found = panelOf(id);
    const conn = found ? deps.manager.get(found.connection) : undefined;
    if (!conn) throw new Error("This search's connection was removed.");
    return conn;
  };
  /** The cache of a connection, opened (it asks nothing: quiet). */
  const viewOf = async (/** @type {Connection} */ conn) => {
    await deps.catalog.schemas(conn, true).catch(() => []);
    return sources.viewFor(conn);
  };
  const sorted = (/** @type {CacheView} */ view) =>
    view.schemas().sort((a, b) => a.localeCompare(b));

  /** The schemas a search reads, and what it says of those it cannot. */
  const stepsOf = async (/** @type {Connection} */ conn, /** @type {Options} */ options) => {
    /** @type {string[]} */
    const notes = [];
    if (options.scope === "all") {
      const all = await sources.views();
      return {
        steps: all.flatMap(({ conn: c, view }) =>
          sorted(view).map((schema) => ({ conn: c, view, schema })),
        ),
        notes,
      };
    }
    const view = await viewOf(conn);
    if (!view)
      throw new Error(
        `${conn.name} has no schema cache: Database: read the schema again reads it.`,
      );
    if (options.scope === "database")
      return { steps: sorted(view).map((schema) => ({ conn, view, schema })), notes };
    if (!view.held(options.schema))
      throw new Error(
        `${options.schema || "No schema"} is not in ${conn.name}'s schema cache: pick a cached one, or read it with Database: read the schema again.`,
      );
    return { steps: [{ conn, view, schema: options.schema }], notes };
  };

  /** Open (or show again) a connection's search; `text` among the fields searches at once. */
  const open = async (/** @type {Record<string, unknown>} */ args) => {
    const ref = typeof args.connection === "string" && args.connection ? args.connection : "";
    const shown = deps.consoles.current();
    const conn =
      (!ref && shown ? deps.manager.get(shown.connection) : undefined) ??
      (await deps.manager.choose(
        ref || undefined,
        "Database: search the source on which connection?",
      ));
    if (!conn) return undefined;
    if (conn.engine !== "postgresql")
      throw new Error(
        `${conn.name} is not PostgreSQL: the source search reads PostgreSQL's schema cache.`,
      );
    const view = await viewOf(conn);
    const schemas = view ? sorted(view) : [];
    const name = `source: ${conn.name}`;
    const kept = panels().find((b) => b.connection === conn.id && b.name === name)?.[TYPE];
    const direct = typeof args.text === "string" && args.text !== "";
    /** @type {Options} */
    const base = (!direct && kept?.options) || {
      ...defaults(),
      schema: schemas.includes("public") ? "public" : (schemas[0] ?? ""),
    };
    const options = optionsOf(args, base);
    /** @type {SourceState} */
    const state = {
      conn: { name: conn.name, engine: conn.engine, readOnly: conn.readOnly, tag: conn.tag },
      schemas,
      options,
      run: kept?.run ?? null,
      error: "",
    };
    const panel = await deps.consoles.openPanel(conn, TYPE, name, state);
    if (!direct) {
      deps.say("Type what to find in the source of routines, views and table parts, then Search.");
      return { opened: panel.id };
    }
    return answerOf(await start(panel.id, {}));
  };

  /** Keep the form's options as they change. */
  const change = (/** @type {string} */ id, /** @type {Record<string, unknown>} */ fields) => {
    const state = stateOf(id);
    if (state) update(id, { options: optionsOf(fields, state.options) });
  };

  /**
   * Search with the panel's options (and the fields given); resolves with the run once it ends.
   * @param {string} id
   * @param {Record<string, unknown>} fields
   * @returns {Promise<Run>}
   */
  const start = async (id, fields) => {
    const state = stateOf(id);
    if (!state) throw new Error("No source search panel is open.");
    if (running.has(id)) throw new Error("A source search is going on: cancel it first.");
    const conn = connOf(id);
    const options = optionsOf(fields, state.options);
    const control = new AbortController();
    running.set(id, control);
    const matcher = createMatcher(deps.startWorker);
    try {
      update(id, { options, error: "" });
      if (options.text === "") throw new Error("Type the text to find first.");
      if (options.kinds.length === 0) throw new Error("Pick at least one kind of object.");
      const { steps, notes } = await stepsOf(conn, options);
      let run = { ...newRun(options, steps.length, now()), notes };
      const tell = (/** @type {Partial<Run>} */ patch = {}) => {
        run = { ...run, ...patch, ms: now() - run.started };
        update(id, { run });
        return run;
      };
      tell();
      for (const step of steps) {
        if (control.signal.aborted) break;
        tell({ current: `${step.conn.name} · ${step.schema}` });
        const hits = await searchStep(step, options, control.signal, (note) => {
          run = { ...run, notes: [...run.notes, note] };
        }).catch((error) => {
          if (isCancel(error) || control.signal.aborted) return undefined;
          throw error;
        });
        if (!hits) break;
        run = fold(run, hits);
        tell({ done: run.done + 1 });
      }
      const end = tell({ phase: control.signal.aborted ? "cancelled" : "done", current: "" });
      deps.say(summaryText(end));
      return end;
    } catch (error) {
      update(id, { error: words(error) });
      throw error;
    } finally {
      matcher.stop();
      running.delete(id);
    }

    /**
     * One schema: its items, the bodies it still needs, the matches.
     * @param {Step} step
     * @param {Options} o
     * @param {AbortSignal} signal
     * @param {(note: string) => void} note
     * @returns {Promise<Hit[]>}
     */
    async function searchStep(step, o, signal, note) {
      const { conn: on, view, schema } = step;
      const read = view.objects(schema);
      const held = read ? heldFor(read) : new Map();
      const need = needOf(view, schema, o.kinds);
      const left = missing(need, held);
      if (left.routines.length || left.views.length)
        try {
          await readBodies(deps.execute, on, schema, need, held, signal);
        } catch (error) {
          if (isCancel(error) || signal.aborted) throw error;
          note(
            `${on.name} · ${schema}: the bodies of its routines and views were not read: ${words(error)}`,
          );
        }
      const items = itemsOf(view, schema, o, held);
      const found = await matcher.match(
        items.map((i) => i.text),
        o,
        items.map((i) => i.skip),
        signal,
      );
      return items.flatMap((item, i) => {
        const f = found[i];
        if (!f) return [];
        /** @type {Hit} */
        const hit = {
          connection: on.id,
          where: on.name,
          kind: item.kind,
          schema: item.schema,
          table: item.table,
          name: item.name,
          ident: item.ident,
          count: f.count,
          lines: f.lines,
          ...(SOURCE_KINDS.has(item.kind) ? {} : { text: item.text }),
        };
        return [hit];
      });
    }
  };

  /** Stop a panel's search: the read in flight and every schema after it. */
  const cancel = (/** @type {string | undefined} */ id) => {
    const shown = deps.consoles.current();
    const target = id ?? (shown?.kind === TYPE ? shown.id : [...running.keys()].at(-1));
    const control = target ? running.get(target) : undefined;
    if (!control) throw new Error("No source search is going on.");
    control.abort();
    return { cancelled: true };
  };

  /**
   * Open a result's source, or its DDL, with the line selected.
   * @param {string} id
   * @param {number} o the object's index in the results
   * @param {number} [l] the line's index in it (its first when absent)
   */
  const openHit = async (id, o, l = 0) => {
    const hit = stateOf(id)?.run?.objects[o];
    if (!hit) throw new Error("That result is gone: search again.");
    const conn = deps.manager.get(hit.connection);
    if (!conn) throw new Error(`${hit.where} was removed.`);
    const line = hit.lines[l]?.line ?? hit.lines[0]?.line ?? 1;
    let text = hit.text ?? "";
    let what = "its DDL";
    if (SOURCE_KINDS.has(hit.kind)) {
      const target = { kind: hit.kind, schema: hit.schema, name: hit.name, ident: hit.ident };
      await openSource(deps, conn, target);
      text = deps.view.editor().text;
      what = "its source";
    } else {
      const title = hit.table ? `${hit.table}.${hit.name}` : `${hit.schema}.${hit.name}`;
      await deps.consoles.openText(conn, title, text);
    }
    const at = lineRange(text, line);
    deps.view.select(at.from, at.to);
    deps.view.focus("editor");
    deps.say(`${hit.name}: line ${line} of ${what}.`);
    return { line };
  };

  return { open, change, start, cancel, openHit };
}
