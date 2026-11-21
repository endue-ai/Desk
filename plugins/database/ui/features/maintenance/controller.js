// The maintenance forms' controller: one panel per PostgreSQL connection and target (a table, an
// index, a schema, the database), its facts read when it opens and on a read again (one read at a
// time), its operation and options checked as they change, and what the palette and agents are
// answered. choose.js finds the connection and target, runs.js runs. index.js's commands and
// actions call it. No DOM.

import { createChooser, operationOf, postgres } from "./choose.js";
import { locksOf } from "./locks.js";
import { labelOf, summaryOf, targetFrom, targetOf, WHOLE } from "./model.js";
import { DEFAULTS, patched, TITLES, usingOf } from "./options.js";
import { createReader } from "./read.js";
import { createRuns } from "./runs.js";
import { statementOf, tooOld } from "./sql.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./options.js").Target} Target
 * @typedef {import("./options.js").Operation} Operation
 * @typedef {import("./model.js").Read} Read
 * @typedef {import("./model.js").Stats} Stats
 * @typedef {{
 *   status: "running" | "done" | "failed" | "cancelled", sql: string, started: number, reads: number,
 *   progress: import("./model.js").Progress | null, output: string[], error: string, ms: number,
 *   before: Stats | null, after: Stats | null, cancelling: boolean, note: string,
 * }} Run
 *   `reads` counts the progress reads, so the panel reads again after each one.
 * @typedef {{
 *   conn: { name: string, readOnly: boolean, tag: string }, target: Target, read: Read | null,
 *   reading: boolean, error: string, operation: Operation,
 *   options: import("./options.js").Options, run: Run | null, timeout: number,
 * }} MaintenanceState
 *   `timeout` is the plugin's statement timeout in seconds (0 for none), which ends a run too.
 */

export const TYPE = "maintenance";

const about = (/** @type {Connection} */ c) => ({ name: c.name, readOnly: c.readOnly, tag: c.tag });
const words = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

/** What the form shows, as the palette and agents read it. */
export function answerOf(/** @type {MaintenanceState} */ s, /** @type {number} */ timeout) {
  const read = s.read;
  if (!read) return { target: labelOf(s.target, ""), error: s.error };
  const { sql, problem } = statementOf(s, read);
  const { heavy, lines } = locksOf(s, read, timeout);
  return {
    target: labelOf(s.target, read.database),
    server: read.server,
    operation: TITLES[s.operation],
    statement: sql,
    ...(problem ? { problem } : {}),
    blocksReadsOrWrites: heavy,
    locks: lines,
    before: read.stats,
  };
}

/** @param {Deps} deps */
export function createMaintenance(deps) {
  const reader = createReader({ execute: deps.execute });
  /** @type {Map<string, Promise<Read | null>>} */
  const reading = new Map();
  const panels = () => deps.consoles.list().filter((b) => b.kind === TYPE);
  const panelOf = (/** @type {string} */ id) => panels().find((b) => b.id === id);
  /** @returns {MaintenanceState | undefined} */
  const stateOf = (/** @type {string} */ id) => panelOf(id)?.[TYPE];
  const update = (/** @type {string} */ id, /** @type {Partial<MaintenanceState>} */ patch) => {
    const now = stateOf(id);
    if (now) deps.consoles.updatePanel(id, { ...now, ...patch });
  };
  const connOf = (/** @type {string} */ id) => {
    const found = panelOf(id);
    const conn = found ? deps.manager.get(found.connection) : undefined;
    if (!found || !conn) throw new Error("This form's connection was removed.");
    return { conn, state: /** @type {MaintenanceState} */ (found[TYPE]) };
  };
  const { choose, pickTarget } = createChooser(deps);
  const { run, progress, cancel } = createRuns({ deps, reader, stateOf, update, connOf });

  /** Read a form's target again; one read at a time per form. */
  const refresh = async (/** @type {string} */ id) => {
    const running = reading.get(id);
    if (running) return running;
    const { conn, state } = connOf(id);
    if (state.run?.status === "running") throw new Error("A run is going on: read again after it.");
    const work = (async () => {
      update(id, {
        reading: true,
        error: "",
        conn: about(conn),
        timeout: deps.settings().timeoutSeconds,
      });
      try {
        const read = await reader.facts(conn, state.target);
        const old = tooOld(conn.name, read.version, read.server);
        if (old) throw new Error(old);
        const now = /** @type {MaintenanceState} */ (stateOf(id) ?? state);
        const target =
          now.target.kind === "index" ? { ...now.target, table: read.table } : now.target;
        const using =
          target.kind === "table" ? usingOf(read.indexes, now.options.using) : now.options.using;
        const tablespace = read.tablespaces.includes(now.options.tablespace)
          ? now.options.tablespace
          : "";
        update(id, {
          read,
          target,
          reading: false,
          options: { ...now.options, using, tablespace },
        });
        return read;
      } catch (error) {
        update(id, { reading: false, error: words(error) });
        return null;
      }
    })();
    reading.set(id, work);
    try {
      return await work;
    } finally {
      reading.delete(id);
    }
  };

  /** Open (or show again) the form of a connection's target, read it, and answer what it shows. */
  const openFor = async (
    /** @type {Connection} */ conn,
    /** @type {Target} */ target,
    /** @type {Record<string, any>} */ args,
  ) => {
    postgres(conn);
    const name = `${TYPE}: ${conn.name} · ${labelOf(target, conn.database)}`;
    const kept = panels().find((b) => b.connection === conn.id && b.name === name)?.[TYPE];
    if (kept?.run?.status === "running") {
      const shown = await deps.consoles.openPanel(conn, TYPE, name, kept);
      if (args.run === true) throw new Error("This form's run is still going on.");
      return answerOf(
        /** @type {MaintenanceState} */ (stateOf(shown.id)),
        deps.settings().timeoutSeconds,
      );
    }
    /** @type {MaintenanceState} */
    const base = kept ?? {
      conn: about(conn),
      target,
      read: null,
      reading: false,
      error: "",
      operation: operationOf(undefined, target),
      options: { ...DEFAULTS },
      run: null,
      timeout: deps.settings().timeoutSeconds,
    };
    const operation = args.operation ? operationOf(args.operation, target) : base.operation;
    // A caller's options are the statement's whole set, on the defaults; with none, the form keeps
    // what the person set in it.
    const options = args.options ? patched({ ...DEFAULTS }, args.options, null) : base.options;
    const panel = await deps.consoles.openPanel(conn, TYPE, name, {
      ...base,
      conn: about(conn),
      operation,
      options,
    });
    const read = await refresh(panel.id);
    const now = /** @type {MaintenanceState} */ (stateOf(panel.id));
    if (!read) throw new Error(now.error || "Not read.");
    const picks = Object.fromEntries(
      Object.entries(args.options ?? {}).filter(([key]) => key === "using" || key === "tablespace"),
    );
    if (Object.keys(picks).length) update(panel.id, { options: patched(now.options, picks, read) });
    deps.say(
      `${labelOf(now.target, read.database)} on ${conn.name}: ${summaryOf(now.target, read.stats)}.`,
    );
    if (args.run === true) return run(panel.id, { agent: true });
    return answerOf(
      /** @type {MaintenanceState} */ (stateOf(panel.id)),
      deps.settings().timeoutSeconds,
    );
  };

  /**
   * The command: a connection and a target from its arguments (a connection named alone is its
   * whole database), else the screen or the palette.
   */
  const open = async (/** @type {Record<string, any>} */ args) => {
    const conn = await choose(args.connection);
    if (!conn) return undefined;
    const target = targetFrom(args) ?? (args.connection ? { ...WHOLE } : await pickTarget(conn));
    return target ? openFor(conn, target, args) : undefined;
  };

  /** The explorer's row (m). */
  const fromNode = (/** @type {import("../../explorer.js").Node} */ node) => {
    const conn = deps.manager.get(node.connection);
    if (!conn) throw new Error("Pick a connection, a schema, a table or an index in the explorer.");
    return openFor(postgres(conn), targetOf(node), {});
  };

  /** Change a form's operation or options; nothing is read or run. */
  const view = (/** @type {string} */ id, /** @type {Record<string, any>} */ patch) => {
    const { state } = connOf(id);
    if (state.run?.status === "running")
      throw new Error("A run is going on: wait for it, or cancel it.");
    const operation =
      "operation" in patch ? operationOf(patch.operation, state.target) : state.operation;
    const options = patch.options
      ? patched(state.options, patch.options, state.read)
      : state.options;
    deps.consoles.updatePanel(id, { ...state, operation, options });
  };

  /** The form on screen, for the palette's commands. */
  const shown = () => {
    const here = deps.consoles.current();
    if (here?.kind !== TYPE)
      throw new Error("No maintenance form on screen: open one with Database: maintenance.");
    return here.id;
  };

  return {
    open,
    fromNode,
    view,
    run,
    refresh,
    progress,
    cancel,
    runShown: () => run(shown()),
    cancelShown: () => cancel(shown()),
    refreshShown: async () => {
      const id = shown();
      const read = await refresh(id);
      if (!read) throw new Error(stateOf(id)?.error || "Not read.");
      return answerOf(
        /** @type {MaintenanceState} */ (stateOf(id)),
        deps.settings().timeoutSeconds,
      );
    },
  };
}
