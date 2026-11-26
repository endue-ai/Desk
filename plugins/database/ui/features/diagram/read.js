// What a diagram reads (PG-55): the graph of the schemas it needs, from the schema cache where it
// holds them (PostgreSQL: through its public `open` and `view`, ADR 0285) and from the catalog's two
// diagram queries elsewhere; the schemas a choice needs (a table's neighbours may be in any schema
// the cache holds); and the state the panel draws, laid out in the frame or the worker. No DOM.

import { layoutOf, problemOf } from "./layout.js";
import { laidOut } from "./layout-client.js";
import {
  graphFromCache,
  graphFromRows,
  idOf,
  merge,
  shownIds,
  subgraph,
  withDrawn,
} from "./model.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {ReturnType<typeof import("../../catalog.js").createCatalog>} Catalog
 * @typedef {import("./model.js").Graph} Graph
 * @typedef {import("./model.js").Choice} Choice
 * @typedef {import("./kept.js").Record} Record
 * @typedef {{
 *   id: string, connection: string, record: Record, layout: import("./layout.js").Layout,
 *   counts: { tables: number, links: number, drawn: number }, kept: boolean, schemas: string[],
 *   arranged?: number,
 * }} DiagramState
 *   `id` names the diagram (its record's key); `schemas` are the ones its graph was read from;
 *   `kept` is false when its record is past the store's cap; `arranged` counts the Auto layouts (the
 *   panel fits the view after one).
 */

/** The schema cache's view of a connection, opened, or undefined for an engine it does not hold. */
async function cacheView(
  /** @type {Catalog} */ catalog,
  /** @type {Connection} */ conn,
  quiet = false,
) {
  if (!catalog.cache.cached(conn)) return undefined;
  await catalog.cache.open(conn, quiet);
  return catalog.cache.view(conn);
}

/** The schemas a diagram reads: its own, and for a table's neighbours every one the cache holds. */
export async function schemasFor(
  /** @type {Catalog} */ catalog,
  /** @type {Connection} */ conn,
  /** @type {Choice} */ choice,
  quiet = false,
) {
  const own = new Set(choice.schemas);
  if (choice.around) {
    own.add(choice.around[0]);
    for (const s of (await cacheView(catalog, conn, quiet))?.schemas() ?? []) own.add(s);
  }
  return [...own];
}

/** The graph of a connection's schemas. @returns {Promise<Graph>} */
export async function readGraph(
  /** @type {Catalog} */ catalog,
  /** @type {Connection} */ conn,
  /** @type {string[]} */ schemas,
  quiet = false,
) {
  const view = await cacheView(catalog, conn, quiet);
  const held = schemas.filter((s) => view?.held(s));
  const graphs = view && held.length ? [graphFromCache(view, held)] : [];
  for (const schema of schemas)
    if (!held.includes(schema))
      graphs.push(graphFromRows(schema, await catalog.diagram(conn, schema, quiet)));
  return merge(graphs);
}

/**
 * The state a record draws over a graph: its tables laid out (kept positions stay unless `arrange`),
 * and the record with every shown table's position, dropped and removed tables gone.
 * @param {Connection} conn
 * @param {string} id
 * @param {Graph} graph
 * @param {Record} record
 * @param {{ arrange?: boolean, schemas: string[] }} options
 * @returns {Promise<DiagramState>}
 */
export async function stateOf(conn, id, graph, record, { arrange = false, schemas }) {
  const full = withDrawn(graph, record.drawn);
  const shown = subgraph(full, shownIds(full, record.choice, record));
  /** @type {Map<string, [number, number]>} */
  const kept = new Map(
    arrange
      ? []
      : record.at.map(([s, t, x, y]) => [idOf(s, t), /** @type {[number, number]} */ ([x, y])]),
  );
  const made = problemOf(shown, record.mode, kept);
  const layout = layoutOf(shown, record.mode, made, await laidOut(made.problem));
  const ids = new Set(shown.tables.map((t) => t.id));
  const has = new Set(graph.tables.map((t) => t.id));
  return {
    id,
    connection: conn.id,
    record: {
      ...record,
      at: layout.boxes.map((b) => [b.schema, b.name, b.x, b.y]),
      added: record.added.filter((r) => has.has(idOf(...r)) && ids.has(idOf(...r))),
      removed: record.removed.filter((r) => has.has(idOf(...r))),
      drawn: record.drawn.filter((d) => has.has(idOf(...d.from)) && has.has(idOf(...d.to))),
    },
    layout,
    counts: {
      tables: shown.tables.length,
      links: shown.links.filter((l) => !l.drawn).length,
      drawn: shown.links.filter((l) => l.drawn).length,
    },
    kept: true,
    schemas,
  };
}
