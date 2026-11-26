// The ER diagram (item 9, PG-55): the explorer's r draws a schema's tables (those its filter keeps)
// or a table with its neighbours, and commands draw a schema, several, or a table's neighbours to a
// depth; the person moves tables (kept per connection and diagram in the plugin's store, ADR 0315),
// lays them out again, picks the columns shown, adds and removes tables and schemas, draws relations
// the database does not declare, and exports the diagram as SVG or PNG or copies it as an image.
// controller.js and edit.js change diagrams, export.js writes them, panel.js draws. No DOM here.

import { createDiagrams, TYPE } from "./controller.js";
import { createEdits } from "./edit.js";
import { copyDiagram, exportDiagram } from "./export.js";
import { MODES } from "./layout.js";
import { diagramPanel } from "./panel.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../explorer.js").Node} Node
 * @typedef {import("./model.js").Choice} Choice
 * @typedef {import("./layout.js").Mode} Mode
 */

/** One set of diagrams per plugin, shared by the feature's commands and actions. */
const made = new WeakMap();
const of = (/** @type {Deps} */ deps) => {
  let found = made.get(deps);
  if (!found) {
    const diagrams = createDiagrams(deps);
    found = { diagrams, edits: createEdits(deps, diagrams) };
    made.set(deps, found);
  }
  return /** @type {{ diagrams: ReturnType<typeof createDiagrams>, edits: ReturnType<typeof createEdits> }} */ (
    found
  );
};

const modeOf = (/** @type {unknown} */ m) =>
  MODES.includes(/** @type {Mode} */ (m)) ? { mode: /** @type {Mode} */ (m) } : {};

const byAgent = (/** @type {import("@endue-ai/plugin-sdk").Invocation | undefined} */ invocation) =>
  /^(agent|mcp):/u.test(invocation?.caller ?? "");

/** The connection a request names (an explorer row's, or the command's, asked when missing). */
async function connectionOf(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ ref) {
  const conn =
    "kind" in ref && typeof ref.connection === "string"
      ? deps.manager.get(ref.connection)
      : await deps.manager.choose(
          /** @type {string | undefined} */ (ref.connection),
          "Database: diagram of which connection?",
        );
  if (!conn) throw deps.cancelled("No diagram drawn.");
  return conn;
}

/** A schema of the connection, asked when the request names none. */
async function schemaOf(
  /** @type {Deps} */ deps,
  /** @type {import("../../engines/common.js").Connection} */ conn,
  /** @type {unknown} */ given,
) {
  if (typeof given === "string" && given) return given;
  const schemas = await deps.catalog.schemas(conn);
  const picked =
    schemas.length === 1
      ? schemas[0]
      : await deps.pick(
          "Database: diagram of which schema?",
          schemas.map((s) => ({ id: s, label: s })),
        );
  if (!picked) throw deps.cancelled("No diagram drawn.");
  return picked;
}

/** A diagram from an explorer row (r) or from Database: ER diagram of a schema. */
async function draw(
  /** @type {Deps} */ deps,
  /** @type {Record<string, unknown>} */ ref,
  read = false,
) {
  if (
    read &&
    (typeof ref.connection !== "string" ||
      (typeof ref.schema !== "string" && !Array.isArray(ref.schemas)))
  )
    throw new Error("Name the connection and schemas for the diagram.");
  const conn = await connectionOf(deps, ref);
  const row = "kind" in ref;
  /** @type {Choice} */
  let choice;
  if (typeof ref.table === "string" && ref.table && (!row || ref.kind === "table")) {
    const schema = await schemaOf(deps, conn, ref.schema);
    const depth = row ? 1 : await of(deps).diagrams.depth(ref.depth ?? 1);
    choice = { schemas: [schema], around: [schema, ref.table], depth };
  } else {
    const schemas = Array.isArray(ref.schemas)
      ? ref.schemas.map(String)
      : [await schemaOf(deps, conn, ref.schema)];
    const filter =
      typeof ref.filter === "string" ? ref.filter.trim() : row ? deps.explorer.filtering() : "";
    choice = { schemas, ...(filter ? { filter } : {}) };
  }
  return read
    ? of(deps).diagrams.read(conn, choice)
    : of(deps).diagrams.open(conn, choice, modeOf(ref.columns));
}

/** Database: ER diagram of a table and its neighbours: the table asked when not named. */
async function around(
  /** @type {Deps} */ deps,
  /** @type {Record<string, unknown>} */ args,
  read = false,
) {
  if (
    read &&
    (typeof args.connection !== "string" ||
      typeof args.schema !== "string" ||
      typeof args.table !== "string")
  )
    throw new Error("Name the connection, schema and table for the diagram.");
  const conn = await connectionOf(deps, args);
  const schema = await schemaOf(deps, conn, args.schema);
  let table = typeof args.table === "string" ? args.table : "";
  if (!table) {
    const tables = (await deps.catalog.tables(conn, schema)).filter((t) => t.type === "table");
    table =
      (await deps.pick(
        "Database: neighbours of which table?",
        tables.map((t) => ({ id: t.name, label: t.name })),
      )) ?? "";
    if (!table) throw deps.cancelled("No diagram drawn.");
  }
  const depth = await of(deps).diagrams.depth(read ? (args.depth ?? 1) : args.depth);
  if (read)
    return of(deps).diagrams.read(conn, { schemas: [schema], around: [schema, table], depth });
  return of(deps).diagrams.open(
    conn,
    { schemas: [schema], around: [schema, table], depth },
    modeOf(args.columns),
  );
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "diagram",
  commands: (deps) => {
    const { diagrams, edits } = of(deps);
    return {
      "endue.database.er-diagram": (args, invocation) => draw(deps, args, byAgent(invocation)),
      "endue.database.er-neighbours": (args, invocation) => around(deps, args, byAgent(invocation)),
      "endue.database.er-arrange": (args) => diagrams.arrange(args.diagram),
      "endue.database.er-columns": (args) => diagrams.columns(args.diagram, args.columns),
      "endue.database.er-add-table": (args) => edits.add(args.diagram, args.table),
      "endue.database.er-remove-table": (args) => edits.remove(args.diagram, args.table),
      "endue.database.er-expand": (args) => edits.expand(args.diagram, args.table, args.depth),
      "endue.database.er-add-schema": (args) => edits.addSchema(args.diagram, args.schema),
      "endue.database.er-relation": (args) => edits.relation(args.diagram, args),
      "endue.database.er-remove-relation": (args) => edits.unrelate(args.diagram, args.relation),
      "endue.database.er-export": (args) =>
        exportDiagram(deps, diagrams.target(args.diagram), args),
      "endue.database.er-copy-image": (args) => copyDiagram(deps, diagrams.target(args.diagram)),
    };
  },
  actions: (deps) => {
    const { diagrams, edits } = of(deps);
    return {
      diagram: (/** @type {Node} */ node) => draw(deps, /** @type {never} */ (node)),
      diagramArrange: (/** @type {string} */ id) => diagrams.arrange(id),
      diagramColumns: (/** @type {string} */ id, /** @type {unknown} */ mode) =>
        diagrams.columns(id, mode),
      diagramMoved: (/** @type {string} */ id, /** @type {[string, number, number][]} */ moves) =>
        diagrams.moved(id, moves),
      diagramAdd: (/** @type {string} */ id) => edits.add(id, undefined),
      diagramAddSchema: (/** @type {string} */ id) => edits.addSchema(id, undefined),
      diagramRemove: (/** @type {string} */ id, /** @type {string} */ table) =>
        edits.remove(id, table),
      diagramExpand: (/** @type {string} */ id, /** @type {string} */ table) =>
        edits.expand(id, table, undefined),
      diagramRelation: (/** @type {string} */ id) => edits.relation(id, {}),
      diagramExport: (/** @type {string} */ id, /** @type {unknown} */ format) =>
        exportDiagram(deps, diagrams.target(id), { format }),
      diagramCopy: (/** @type {string} */ id) => copyDiagram(deps, diagrams.target(id)),
      diagramFlush: () => diagrams.flush(),
    };
  },
  panels: {
    [TYPE]: {
      label: "ER diagram",
      render: (doc, state, act, buffer) => diagramPanel(doc, state, act, buffer),
    },
  },
  styles: [new URL("./diagram.css", import.meta.url).href],
};
