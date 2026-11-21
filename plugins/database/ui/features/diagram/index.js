// The ER diagram of a schema (item 9), the first feature: Database: ER diagram of a schema and the
// explorer's r read the schema's tables, columns and foreign keys and draw them in a panel of its
// own, one per connection and schema, drawn again when it is opened again. Enter on a table opens
// its rows. The panel keeps nothing across a restart. No DOM here: panel.js draws.

import { layout } from "../../schema/diagram.js";
import { diagramView } from "./panel.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../explorer.js").Node} Node
 * @typedef {{ schema: string, layout: import("../../schema/diagram.js").Layout }} DiagramState
 */

/** Draw a schema's diagram: an explorer row (r), or the command's connection and schema. */
async function draw(/** @type {Deps} */ deps, /** @type {Node | Record<string, unknown>} */ ref) {
  const { manager, catalog, consoles } = deps;
  const conn =
    "kind" in ref && typeof ref.connection === "string"
      ? manager.get(ref.connection)
      : await manager.choose(
          /** @type {string | undefined} */ (ref.connection),
          "Database: diagram of which connection?",
        );
  const schema = typeof ref.schema === "string" ? ref.schema : undefined;
  if (!conn || schema === undefined)
    throw new Error("Pick a schema in the explorer (r), or name connection and schema.");
  const diagram = await catalog.diagram(conn, schema);
  /** @type {DiagramState} */
  const state = { schema, layout: layout(diagram) };
  await consoles.openPanel(conn, "diagram", `er: ${conn.name} · ${schema}`, state);
  deps.say(`${diagram.tables.length} tables, ${diagram.links.length} foreign keys.`);
  return { tables: diagram.tables.length, links: diagram.links.length };
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "diagram",
  commands: (deps) => ({ "endue.database.er-diagram": (args) => draw(deps, args) }),
  actions: (deps) => ({ diagram: (/** @type {Node} */ node) => draw(deps, node) }),
  panels: {
    diagram: {
      label: "ER diagram",
      render: (doc, /** @type {DiagramState} */ state, act, buffer) =>
        diagramView(doc, state.layout, (table) =>
          act("openTable", buffer.connection, state.schema, table),
        ),
    },
  },
  styles: [new URL("./diagram.css", import.meta.url).href],
};
