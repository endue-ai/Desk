// The comparison's controller (PG-53, ADR 0338): one panel per pair of sides, each side read (a
// schema of a connection, a folder, a snapshot) with progress and Cancel, compared (client.js), the
// objects the person chose and the direction kept, the script written for them (migrate.js), run
// only when the person says so (run.js), or opened in a console. The models stay here, not in the
// panel's state. No DOM.

import { compareIn } from "./client.js";
import { modelOfFiles, schemaOfFiles } from "./folder.js";
import { migrationOf } from "./migrate.js";
import { readSchema } from "./read.js";
import { createRun, refusalOf } from "./run.js";
import { snapshotModel } from "./snapshot.js";
import { openSnapshot, readFolder } from "./files.js";
import { connectionOf } from "./sides.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("./model.js").Model} Model
 * @typedef {import("../table-design/read.js").Facts} Facts
 * @typedef {import("./sides.js").Side} Side
 * @typedef {import("./diff.js").Item} Item
 * @typedef {{
 *   left: Side, right: Side, status: "reading" | "comparing" | "done" | "failed" | "cancelled",
 *   progress: { done: number, total: number, what: string }, error: string, items: Item[],
 *   same: number, notes: string[], chosen: string[], selected: string, target: "left" | "right",
 *   script: { text: string, held: string[], steps: number } | null,
 *   run: import("./run.js").Run | null, refused: string,
 * }} SchemaState
 *   `target` is the side the script makes like the other; `chosen` the keys the script covers;
 *   `refused` why Run waits ("" when it may run).
 */

export const TYPE = "schemaCompare";
const words = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));
const cancelled = (/** @type {unknown} */ e) =>
  /** @type {{ code?: string }} */ (e)?.code === "cancelled";

/** @param {Deps} deps */
export function createSchemaCompare(deps) {
  /** @type {Map<string, { left?: { model: Model, facts: Facts | null }, right?: { model: Model, facts: Facts | null }, stop?: AbortController }>} */
  const held = new Map();
  const panels = () => deps.consoles.list().filter((b) => b.kind === TYPE);
  const panelOf = (/** @type {string} */ id) => panels().find((b) => b.id === id);
  /** @returns {SchemaState | undefined} */
  const stateOf = (/** @type {string} */ id) => panelOf(id)?.[TYPE];
  const update = (/** @type {string} */ id, /** @type {Partial<SchemaState>} */ patch) => {
    const now = stateOf(id);
    if (!now) return;
    const next = { ...now, ...patch };
    try {
      next.refused = refusalOf(deps, next);
    } catch (error) {
      next.refused = words(error);
    }
    deps.consoles.updatePanel(id, next);
  };
  const mine = (/** @type {string} */ id) => {
    const got = held.get(id) ?? {};
    held.set(id, got);
    return got;
  };

  /** One side read as a model, with its server's facts when it is a schema. */
  const readSide = async (
    /** @type {Side} */ side,
    /** @type {string} */ other,
    /** @type {AbortSignal} */ signal,
    /** @type {(what: string, done: number, total: number) => void} */ tick,
  ) => {
    if (side.kind === "schema") {
      const conn = connectionOf(deps, side);
      const got = await readSchema(deps, conn, side.schema, {
        signal,
        progress: (p) => tick(`${side.label}: ${p.what || "read"}`, p.done, p.total),
      });
      return { model: got.model, facts: /** @type {Facts | null} */ (got.facts) };
    }
    if (side.kind === "folder") {
      tick(`${side.label}: reading its files`, 0, 1);
      const files = await readFolder(deps, side.path);
      const schema = side.schema || schemaOfFiles(files) || other || "public";
      return { model: modelOfFiles(schema, files), facts: null };
    }
    tick(`${side.label}: reading it`, 0, 1);
    const { text } = await openSnapshot(deps, side.path);
    return { model: snapshotModel(text).model, facts: null };
  };

  /** The script for what is chosen, in the chosen direction. */
  const scriptFor = (/** @type {string} */ id, /** @type {SchemaState} */ s) => {
    const got = held.get(id);
    if (!got?.left || !got.right) return null;
    const [source, target] = s.target === "right" ? [got.left, got.right] : [got.right, got.left];
    const m = migrationOf(source.model, target.model, s.chosen, target.facts);
    return { text: m.text, held: m.held, steps: m.steps.length };
  };
  const rescript = (/** @type {string} */ id, /** @type {Partial<SchemaState>} */ patch) => {
    const now = /** @type {SchemaState} */ ({ ...stateOf(id), ...patch });
    update(id, { ...patch, script: scriptFor(id, now), run: null });
  };

  /** Read both sides and compare them; a second call while one runs waits for none. */
  const compare = async (/** @type {string} */ id) => {
    const s = /** @type {SchemaState} */ (stateOf(id));
    mine(id).stop?.abort();
    const stop = new AbortController();
    mine(id).stop = stop;
    let last = -1;
    const tick = (
      /** @type {string} */ what,
      /** @type {number} */ done,
      /** @type {number} */ total,
    ) => {
      const at = Math.floor((done / Math.max(total, 1)) * 100);
      if (at === last && what === stateOf(id)?.progress.what) return;
      last = at;
      update(id, { progress: { done, total, what } });
    };
    update(id, {
      status: "reading",
      error: "",
      items: [],
      same: 0,
      notes: [],
      script: null,
      run: null,
    });
    try {
      const left = await readSide(s.left, s.right.schema, stop.signal, tick);
      const right = await readSide(s.right, left.model.schema, stop.signal, tick);
      Object.assign(mine(id), { left, right });
      update(id, { status: "comparing" });
      const done = await compareIn(left.model, right.model, {
        ...(deps.startWorker ? { startWorker: deps.startWorker } : {}),
        signal: stop.signal,
        tick: (d, t) => tick("comparing", d, t),
      });
      const chosen = done.items.map((i) => i.key);
      const notes = [...(left.model.notes ?? []), ...(right.model.notes ?? [])];
      rescript(id, {
        status: "done",
        items: done.items,
        same: done.same,
        notes,
        chosen,
        selected: done.items[0]?.key ?? "",
      });
      return done;
    } catch (error) {
      const off = cancelled(error) || stop.signal.aborted;
      update(id, {
        status: off ? "cancelled" : "failed",
        error: off ? "Cancelled: nothing was compared." : words(error),
      });
      if (off) throw deps.cancelled("Not compared.");
      throw error;
    } finally {
      if (mine(id).stop === stop) delete mine(id).stop;
    }
  };

  const run = createRun({ deps, stateOf, update, held, compare });

  /** Open (or show again) the panel of two sides and compare them. */
  const open = async (/** @type {Side} */ left, /** @type {Side} */ right) => {
    const name = `schemas: ${left.label} ↔ ${right.label}`;
    const at = [left, right].find((x) => x.kind === "schema");
    const home = at ? connectionOf(deps, at) : null;
    /** @type {SchemaState} */
    const base = {
      left,
      right,
      status: "reading",
      progress: { done: 0, total: 1, what: "" },
      error: "",
      items: [],
      same: 0,
      notes: [],
      chosen: [],
      selected: "",
      target: right.kind === "schema" ? "right" : "left",
      script: null,
      run: null,
      refused: "",
    };
    const panel = await deps.consoles.openPanel(home, TYPE, name, base);
    const done = await compare(panel.id);
    return {
      panel: panel.id,
      ...summaryOf(/** @type {SchemaState} */ (stateOf(panel.id))),
      same: done.same,
    };
  };

  return {
    open,
    compare,
    stateOf,
    run: run.run,
    toConsole: run.toConsole,
    cancel(/** @type {string} */ id) {
      const stop = held.get(id)?.stop;
      if (!stop) throw new Error("Nothing is being read.");
      stop.abort();
    },
    choose(/** @type {string} */ id, /** @type {string[]} */ keys, /** @type {boolean} */ on) {
      const s = /** @type {SchemaState} */ (stateOf(id));
      const set = new Set(s.chosen);
      for (const k of keys) on ? set.add(k) : set.delete(k);
      rescript(id, { chosen: s.items.map((i) => i.key).filter((k) => set.has(k)) });
    },
    select: (/** @type {string} */ id, /** @type {string} */ key) => update(id, { selected: key }),
    direction(/** @type {string} */ id) {
      const s = /** @type {SchemaState} */ (stateOf(id));
      rescript(id, { target: s.target === "right" ? "left" : "right" });
    },
    /** The panel on screen, for the palette's commands. */
    shown() {
      const here = deps.consoles.current();
      if (here?.kind !== TYPE)
        throw new Error("No comparison on screen: open one with Database: compare two schemas.");
      return here.id;
    },
  };
}

/** What a comparison shows, as the palette and agents read it. */
export function summaryOf(/** @type {SchemaState} */ s) {
  const count = (/** @type {string} */ state) => s.items.filter((i) => i.state === state).length;
  return {
    left: s.left.label,
    right: s.right.label,
    onlyLeft: count("left"),
    onlyRight: count("right"),
    differ: count("differs"),
    items: s.items.map((i) => ({ kind: i.kind, name: i.name, state: i.state })),
    script: s.script?.text ?? "",
    ...(s.script?.held.length ? { held: s.script.held } : {}),
    ...(s.notes.length ? { notes: s.notes } : {}),
    run: "The person reads the script in the panel and runs it there.",
  };
}
