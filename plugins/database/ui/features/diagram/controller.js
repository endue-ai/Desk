// The diagrams of the plugin (PG-55): one panel per connection and diagram, opened from the explorer
// (r on a schema: its tables, those the explorer's filter keeps; r on a table: it and its neighbours)
// or by command, drawn as its record in the plugin's store left it (kept.js), and changed in place:
// Auto layout, the columns shown, a table moved (kept a moment later, once the moves stop), and the
// edits of edit.js. The graph each diagram read is held for its edits. No DOM.

import { bridgeStore, readKept, writeKept } from "./kept.js";
import { MODES, moveBoxes } from "./layout.js";
import { MAX_DEPTH, nameOf } from "./model.js";
import { readGraph, schemasFor, stateOf } from "./read.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../consoles.js").Console} Console
 * @typedef {import("./model.js").Choice} Choice
 * @typedef {import("./model.js").Graph} Graph
 * @typedef {import("./kept.js").Record} Record
 * @typedef {import("./layout.js").Mode} Mode
 * @typedef {import("./read.js").DiagramState} DiagramState
 * @typedef {{ buffer: Console, conn: Connection, state: DiagramState }} Target
 */

export const TYPE = "diagram";
const SETTLE_MS = 400;

/** @param {Deps} deps */
export function createDiagrams(deps) {
  const store = bridgeStore(deps.bridge);
  /** The graph each diagram read, by its buffer's id. @type {Map<string, Graph>} */
  const graphs = new Map();
  /** Writes waiting for the moves to stop, by buffer id. @type {Map<string, ReturnType<typeof setTimeout>>} */
  const waiting = new Map();

  /** Keep a diagram's record; say once when it is past the store's cap. */
  const save = async (/** @type {Target} */ t) => {
    const done = await writeKept(store, t.conn.id, t.state.id, t.state.record).catch(() => ({
      kept: false,
    }));
    if (!done.kept && t.state.kept)
      deps.say("This diagram is too large to keep: its layout lasts until the plugin restarts.");
    t.state.kept = done.kept;
  };

  /** The diagram a command means: its buffer's id, the one on screen, else the last opened. */
  const target = (/** @type {unknown} */ id) => {
    const list = deps.consoles.list().filter((b) => b.kind === TYPE);
    const shown = deps.consoles.current();
    const buffer =
      (typeof id === "string" ? list.find((b) => b.id === id) : undefined) ??
      (shown?.kind === TYPE ? shown : undefined) ??
      [...list].sort((a, b) => (b.used ?? 0) - (a.used ?? 0))[0];
    if (!buffer)
      throw new Error("No ER diagram is open: Database: ER diagram of a schema opens one.");
    const conn = deps.manager.get(buffer.connection);
    if (!conn) throw new Error("This diagram's connection was removed.");
    return { buffer, conn, state: /** @type {DiagramState} */ (buffer[TYPE]) };
  };

  /** The graph a diagram read, read again when it is not held (after a restart of the plugin). */
  const graphOf = async (/** @type {Target} */ t) => {
    const held = graphs.get(t.buffer.id);
    if (held) return held;
    const graph = await readGraph(deps.catalog, t.conn, t.state.schemas);
    graphs.set(t.buffer.id, graph);
    return graph;
  };

  /**
   * Draw a diagram again after a change to its record; `schemas` reads its graph again first.
   * @param {Target} t
   * @param {(record: Record) => Record} change
   * @param {{ arrange?: boolean, read?: boolean }} [options]
   */
  const redraw = async (t, change, options = {}) => {
    const record = change(structuredClone(t.state.record));
    const schemas = options.read
      ? await schemasFor(deps.catalog, t.conn, record.choice)
      : t.state.schemas;
    if (options.read) graphs.set(t.buffer.id, await readGraph(deps.catalog, t.conn, schemas));
    const graph = await graphOf(t);
    const next = await stateOf(t.conn, t.state.id, graph, record, {
      arrange: options.arrange ?? false,
      schemas,
    });
    next.kept = t.state.kept;
    next.arranged = (t.state.arranged ?? 0) + (options.arrange ? 1 : 0);
    deps.consoles.updatePanel(t.buffer.id, next);
    const moved = { ...t, state: next };
    await save(moved);
    return moved;
  };

  /**
   * Open a connection's diagram of a choice, as its record left it.
   * @param {Connection} conn
   * @param {Choice} choice
   * @param {{ mode?: Mode }} [options]
   */
  const open = async (conn, choice, options = {}) => {
    const id = nameOf(choice);
    const kept = await readKept(store, conn.id, id);
    /** @type {Record} */
    const record = kept ?? { choice, mode: "all", at: [], added: [], removed: [], drawn: [] };
    if (options.mode) record.mode = options.mode;
    const schemas = await schemasFor(deps.catalog, conn, record.choice);
    const graph = await readGraph(deps.catalog, conn, schemas);
    const state = await stateOf(conn, id, graph, record, { schemas });
    const buffer = await deps.consoles.openPanel(conn, TYPE, `er: ${conn.name} · ${id}`, state);
    if (buffer?.id) graphs.set(buffer.id, graph);
    if (buffer?.id) await save({ buffer, conn, state });
    deps.say(`${state.counts.tables} tables, ${state.counts.links} foreign keys.`);
    return { tables: state.counts.tables, links: state.counts.links };
  };

  return {
    open,
    target,
    graphOf,
    redraw,
    /** Lay every table out again. */
    arrange: async (/** @type {unknown} */ id) => {
      await redraw(target(id), (r) => r, { arrange: true });
      deps.say("Laid out again.");
    },
    /** Show all columns, keys only or none (asked when not given). */
    columns: async (/** @type {unknown} */ id, /** @type {unknown} */ mode) => {
      const t = target(id);
      const picked = MODES.includes(/** @type {Mode} */ (mode))
        ? /** @type {Mode} */ (mode)
        : /** @type {Mode | undefined} */ (
            await deps.pick("Database: show which columns in the diagram?", [
              { id: "all", label: "All columns" },
              { id: "keys", label: "Keys only", detail: "Primary and foreign key columns" },
              { id: "none", label: "None", detail: "Table names only" },
            ])
          );
      if (!picked) throw deps.cancelled("The columns stay as they are.");
      await redraw(t, (r) => ({ ...r, mode: picked }));
      return picked;
    },
    /**
     * Tables moved in the panel (which moved them on screen): kept once the moves stop.
     * @param {unknown} id
     * @param {[string, number, number][]} moves table id, x and y
     */
    moved(id, moves) {
      const t = target(id);
      const { layout, record } = t.state;
      const index = new Map(layout.boxes.map((b, i) => [b.id, i]));
      /** @type {Map<number, [number, number]>} */
      const changes = new Map();
      for (const [table, x, y] of moves) {
        const i = index.get(table);
        if (i !== undefined && Number.isFinite(x) && Number.isFinite(y)) changes.set(i, [x, y]);
      }
      if (changes.size === 0) return false;
      moveBoxes(layout, changes);
      record.at = layout.boxes.map((b) => [b.schema, b.name, b.x, b.y]);
      deps.consoles.updatePanel(t.buffer.id, t.state);
      clearTimeout(waiting.get(t.buffer.id));
      waiting.set(
        t.buffer.id,
        setTimeout(() => {
          waiting.delete(t.buffer.id);
          save(t).catch(() => {});
        }, SETTLE_MS),
      );
      return true;
    },
    /** Write now what waits for the moves to stop (tests, a close). */
    async flush() {
      for (const [id, timer] of waiting) {
        clearTimeout(timer);
        waiting.delete(id);
        const t = target(id);
        await save(t);
      }
    },
    /** The depth of a table's neighbours, asked when not given. */
    depth: async (/** @type {unknown} */ given) => {
      const n = Number(given);
      if (Number.isInteger(n) && n >= 1 && n <= MAX_DEPTH) return n;
      const picked = await deps.pick(
        "Database: neighbours how many foreign keys away?",
        [1, 2, 3, 4].map((d) => ({
          id: String(d),
          label: d === 1 ? "1 foreign key away" : `${d} foreign keys away`,
        })),
      );
      if (!picked) throw deps.cancelled("No diagram drawn.");
      return Number(picked);
    },
  };
}
