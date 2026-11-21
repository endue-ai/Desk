// The routine forms' controller (PG-56): one panel per PostgreSQL connection and routine signature,
// the routine read by its oid when the form opens and on Read again, its entries kept as the person
// changes them and remembered per connection and routine for the session (never across a restart:
// the panel keeps nothing), and the run: refused, asked (guard.js), then the call run in the
// connection's console as a console run (its result tabs, Messages with the notices, the history),
// between BEGIN and ROLLBACK when the form says so. index.js's commands and actions call it. No DOM.

import { labelOf as consoleLabel } from "../../console-list.js";
import { callOf } from "./call.js";
import { createChooser, postgres } from "./choose.js";
import { answerOf, entriesFrom } from "./entries.js";
import { canRollBack, questionOf, refusalOf, titleOf } from "./guard.js";
import { createReader } from "./read.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./read.js").Routine} Routine
 * @typedef {import("./call.js").Entry} Entry
 * @typedef {{ status: "done" | "failed", summary: string, console: string, sql: string, rolledBack: boolean }} Last
 * @typedef {{
 *   conn: { name: string, readOnly: boolean, tag: string }, oid: string, routine: Routine | null,
 *   reading: boolean, error: string, entries: (Entry | undefined)[], rollback: boolean,
 *   running: boolean, last: Last | null, reads: number,
 * }} RoutineState
 *   `reads` counts the reads, so the panel draws its fields again after one.
 */

export const TYPE = "routine";
const ROWS = 50;

const about = (/** @type {Connection} */ c) => ({ name: c.name, readOnly: c.readOnly, tag: c.tag });
const words = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));
const keyOf = (/** @type {Connection} */ conn, /** @type {Routine} */ r) =>
  `${conn.id}\u0000${r.schema}.${r.name}(${r.identity})`;

/** @param {Deps} deps */
export function createRoutines(deps) {
  const reader = createReader({ execute: deps.execute });
  const chooser = createChooser({ ...deps, reader });
  /** What was typed for each routine this session. @type {Map<string, { entries: (Entry | undefined)[], rollback: boolean }>} */
  const memory = new Map();
  const panels = () => deps.consoles.list().filter((b) => b.kind === TYPE);
  const panelOf = (/** @type {string} */ id) => panels().find((b) => b.id === id);
  /** @returns {RoutineState | undefined} */
  const stateOf = (/** @type {string} */ id) => panelOf(id)?.[TYPE];
  const connOf = (/** @type {string} */ id) => {
    const found = panelOf(id);
    const conn = found ? deps.manager.get(found.connection) : undefined;
    if (!found || !conn) throw new Error("This form's connection was removed.");
    return { conn, state: /** @type {RoutineState} */ (found[TYPE]) };
  };
  const update = (/** @type {string} */ id, /** @type {Partial<RoutineState>} */ patch) => {
    const found = panelOf(id);
    const now = stateOf(id);
    if (!found || !now) return;
    const next = { ...now, ...patch };
    const conn = deps.manager.get(found.connection);
    if (conn && next.routine && ("entries" in patch || "rollback" in patch))
      memory.set(keyOf(conn, next.routine), { entries: next.entries, rollback: next.rollback });
    deps.consoles.updatePanel(id, next);
  };

  /** Open (or show again) the form of a routine by its oid, and answer what it shows. */
  const openFor = async (
    /** @type {Connection} */ conn,
    /** @type {string} */ oid,
    /** @type {Record<string, unknown>} */ args,
  ) => {
    postgres(conn);
    const routine = await reader.routine(conn, oid);
    const name = `${TYPE}: ${conn.name} · ${routine.schema}.${routine.name}(${routine.identity})`;
    const kept = panels().find((b) => b.connection === conn.id && b.name === name)?.[TYPE];
    if (kept?.running) {
      await deps.consoles.openPanel(conn, TYPE, name, kept);
      throw new Error("This form's run is still going on.");
    }
    const remembered = memory.get(keyOf(conn, routine));
    const entries = entriesFrom(routine, remembered?.entries ?? [], args.arguments);
    const asked = typeof args.rollback === "boolean" ? args.rollback : remembered?.rollback;
    /** @type {RoutineState} */
    const state = {
      conn: about(conn),
      oid: routine.oid,
      routine,
      reading: false,
      error: "",
      entries,
      rollback: Boolean(asked) && canRollBack(routine),
      running: false,
      last: kept?.last ?? null,
      reads: (kept?.reads ?? 0) + 1,
    };
    const panel = await deps.consoles.openPanel(conn, TYPE, name, state);
    memory.set(keyOf(conn, routine), { entries, rollback: state.rollback });
    if (args.run === true) return run(panel.id, { agent: true });
    deps.say(`${titleOf(routine)} on ${conn.name}.`);
    return answerOf(/** @type {RoutineState} */ (stateOf(panel.id) ?? state));
  };

  /** The command: a connection and a routine from its arguments, else the screen and the palette. */
  const open = async (/** @type {Record<string, unknown>} */ args) => {
    const conn = await chooser.connection(args.connection);
    if (!conn) return undefined;
    const listed = await chooser.routine(conn, args);
    return listed ? openFor(conn, listed.oid, args) : undefined;
  };

  /** The explorer's row of a function or procedure (x). */
  const fromNode = (/** @type {import("../../explorer.js").Node} */ node) => {
    const conn = deps.manager.get(node.connection);
    const object = node.object;
    if (!conn || !object || (object.kind !== "function" && object.kind !== "procedure"))
      throw new Error("Pick a function or procedure in the explorer, under Routines.");
    return openFor(postgres(conn), object.ident, {});
  };

  /** Read a form's routine again: its fields are drawn again, the entries kept. */
  const refresh = async (/** @type {string} */ id) => {
    const { conn, state } = connOf(id);
    if (state.running) throw new Error("A run is going on: read again after it.");
    update(id, { reading: true, error: "" });
    try {
      const routine = await reader.routine(conn, state.oid);
      const same = state.routine?.identity === routine.identity;
      update(id, {
        routine,
        reading: false,
        conn: about(conn),
        reads: state.reads + 1,
        entries: same ? state.entries : [],
        rollback: state.rollback && canRollBack(routine),
      });
    } catch (error) {
      update(id, { reading: false, error: words(error) });
      throw error;
    }
    return answerOf(/** @type {RoutineState} */ (stateOf(id)));
  };

  /** Keep what the person changed in a form: its entries, its rollback choice. */
  const view = (/** @type {string} */ id, /** @type {Partial<RoutineState>} */ patch) => {
    const { state } = connOf(id);
    /** @type {Partial<RoutineState>} */
    const next = {};
    if (patch.entries) next.entries = patch.entries;
    if (typeof patch.rollback === "boolean")
      next.rollback = patch.rollback && Boolean(state.routine && canRollBack(state.routine));
    update(id, next);
  };

  /** Run a form's call in the connection's console; the panel's entries, when given, first. */
  const run = async (
    /** @type {string} */ id,
    /** @type {{ agent?: boolean, entries?: (Entry | undefined)[] }} */ how = {},
  ) => {
    if (how.entries) view(id, { entries: how.entries });
    const { conn, state } = connOf(id);
    if (state.running) throw new Error("A run is going on from this form.");
    const r = state.routine;
    if (!r) throw new Error(state.error || "The routine is not read yet.");
    const refused = refusalOf(conn, r);
    if (refused) throw new Error(refused);
    const rollback = state.rollback && canRollBack(r);
    const { sql, problem } = callOf(r, state.entries);
    if (problem) throw new Error(problem);
    const agent = how.agent === true;
    const asked = questionOf(conn, r, sql, { rollback, agent, confirm: deps.settings().confirm });
    if (asked && !(await deps.confirm(asked.title, asked.reasons)))
      throw deps.cancelled("Not run.");
    const target = await deps.consoles.open(conn);
    const where = consoleLabel(target, conn);
    update(id, { running: true });
    let said = "";
    try {
      said = await deps.consoles.runIn(target, conn, sql, {
        mode: rollback ? "dry-run" : "run",
        ...(agent ? { agent: true } : {}),
      });
    } finally {
      update(id, { running: false });
    }
    const result = target.execution?.result;
    const outcome = result?.statements[0];
    const failure = result?.error ?? outcome?.error;
    const summary = target.shown?.summary ?? said;
    /** @type {Last} */
    const last = {
      status: failure ? "failed" : "done",
      summary,
      console: where,
      sql,
      rolledBack: rollback,
    };
    update(id, { last });
    deps.say(`${r.schema}.${r.name} in the console ${where}: ${said || summary}.`);
    const set = outcome?.sets[0];
    return {
      statement: sql,
      console: where,
      status: last.status,
      summary,
      ...(failure ? { error: failure.message } : {}),
      ...(set ? { columns: set.columns, rows: set.rows.slice(0, ROWS) } : {}),
      notices: [...(outcome?.notices ?? []), ...(result?.notices ?? [])],
      rolledBack: rollback,
    };
  };

  /** The form on screen, for the palette's commands. */
  const shown = () => {
    const here = deps.consoles.current();
    if (here?.kind !== TYPE)
      throw new Error(
        "No routine form on screen: open one with Database: run a function or procedure.",
      );
    return here.id;
  };

  return {
    open,
    fromNode,
    refresh,
    view,
    run,
    runShown: () => run(shown()),
    refreshShown: () => refresh(shown()),
  };
}
