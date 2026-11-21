// What the person changes in a diagram besides where its tables are (PG-55): a table added (any of
// the schemas read, or of a schema added), removed, or its neighbours added; and a relation the
// database does not declare, drawn between two tables and kept with the diagram, or taken away.
// Asked in the palette when the command does not say. Never a change to the database (PG-51). No DOM.

import { labelOf } from "./layout.js";
import { drawnName, idOf, neighbours, refOf } from "./model.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {ReturnType<typeof import("./controller.js").createDiagrams>} Diagrams
 * @typedef {import("./controller.js").Target} Target
 * @typedef {import("./model.js").Ref} Ref
 * @typedef {import("./model.js").Table} Table
 */

/** A table named by a command: "schema.table", [schema, table] or { schema, table }. */
function refFrom(/** @type {unknown} */ given, /** @type {Table[]} */ tables) {
  if (Array.isArray(given) && given.length === 2) return /** @type {Ref} */ (given.map(String));
  const g = /** @type {{ schema?: unknown, table?: unknown } | null} */ (given);
  if (g && typeof g === "object" && typeof g.table === "string")
    return /** @type {Ref} */ ([String(g.schema ?? ""), g.table]);
  if (typeof given !== "string" || !given) return undefined;
  if (given.includes("\u0000")) return refOf(given);
  const exact = tables.find((t) => `${t.schema}.${t.name}` === given || t.name === given);
  return exact ? /** @type {Ref} */ ([exact.schema, exact.name]) : undefined;
}

const has = (/** @type {Ref[]} */ list, /** @type {Ref} */ ref) =>
  list.some(([s, t]) => s === ref[0] && t === ref[1]);
const without = (/** @type {Ref[]} */ list, /** @type {Ref} */ ref) =>
  list.filter(([s, t]) => s !== ref[0] || t !== ref[1]);

/**
 * @param {Deps} deps
 * @param {Diagrams} diagrams
 */
export function createEdits(deps, diagrams) {
  const shownOf = (/** @type {Target} */ t) => new Set(t.state.layout.boxes.map((b) => b.id));
  const multi = (/** @type {Table[]} */ tables) => new Set(tables.map((t) => t.schema)).size > 1;

  /** A table of the graph, named or picked among `tables`. */
  const tableOf = async (
    /** @type {unknown} */ given,
    /** @type {Table[]} */ tables,
    /** @type {string} */ title,
  ) => {
    const named = refFrom(given, tables);
    if (named) return named;
    const qualified = multi(tables);
    const picked = await deps.pick(
      title,
      tables.map((t) => ({
        id: t.id,
        label: labelOf(t, qualified),
        ...(t.comment ? { detail: t.comment } : {}),
      })),
    );
    if (!picked) throw deps.cancelled("The diagram stays as it is.");
    return refOf(picked);
  };

  return {
    /** Add a table the diagram does not show. */
    async add(/** @type {unknown} */ id, /** @type {unknown} */ table) {
      const t = diagrams.target(id);
      const shown = shownOf(t);
      const graph = await diagrams.graphOf(t);
      const left = graph.tables.filter((x) => !shown.has(x.id));
      if (!left.length && table === undefined)
        throw new Error("Every table read is shown: Database: add a schema to the ER diagram.");
      const ref = await tableOf(table, left, "Database: add which table to the diagram?");
      await diagrams.redraw(t, (r) => ({
        ...r,
        added: has(r.added, ref) ? r.added : [...r.added, ref],
        removed: without(r.removed, ref),
      }));
      return ref.join(".");
    },
    /** Take a table out of the diagram (never out of the database). */
    async remove(/** @type {unknown} */ id, /** @type {unknown} */ table) {
      const t = diagrams.target(id);
      const graph = await diagrams.graphOf(t);
      const shown = shownOf(t);
      const ref = await tableOf(
        table,
        graph.tables.filter((x) => shown.has(x.id)),
        "Database: remove which table from the diagram?",
      );
      await diagrams.redraw(t, (r) => ({
        ...r,
        added: without(r.added, ref),
        removed: has(r.removed, ref) ? r.removed : [...r.removed, ref],
      }));
      return ref.join(".");
    },
    /** Add a table's neighbours to a depth. */
    async expand(
      /** @type {unknown} */ id,
      /** @type {unknown} */ table,
      /** @type {unknown} */ depth,
    ) {
      const t = diagrams.target(id);
      const graph = await diagrams.graphOf(t);
      const shown = shownOf(t);
      const ref = await tableOf(
        table,
        graph.tables.filter((x) => shown.has(x.id)),
        "Database: add the neighbours of which table?",
      );
      const n = depth === undefined ? 1 : await diagrams.depth(depth);
      const near = [...neighbours(graph, idOf(...ref), n)].map(refOf);
      const fresh = near.filter((r) => !shown.has(idOf(...r)));
      await diagrams.redraw(t, (r) => ({
        ...r,
        added: [...r.added, ...fresh.filter((x) => !has(r.added, x))],
        removed: r.removed.filter((x) => !has(near, x)),
      }));
      deps.say(fresh.length ? `Added ${fresh.length} tables.` : "Its neighbours are all shown.");
      return fresh.length;
    },
    /** Add every table of another schema. */
    async addSchema(/** @type {unknown} */ id, /** @type {unknown} */ schema) {
      const t = diagrams.target(id);
      const all = await deps.catalog.schemas(t.conn);
      const left = all.filter((s) => !t.state.record.choice.schemas.includes(s));
      const picked =
        typeof schema === "string" && all.includes(schema)
          ? schema
          : await deps.pick(
              "Database: add which schema's tables to the diagram?",
              left.map((s) => ({ id: s, label: s })),
            );
      if (!picked) throw deps.cancelled("The diagram stays as it is.");
      await diagrams.redraw(
        t,
        (r) => ({
          ...r,
          choice: { ...r.choice, schemas: [...new Set([...r.choice.schemas, picked])] },
          removed: r.removed.filter(([s]) => s !== picked),
        }),
        { read: true },
      );
      return picked;
    },
    /** Draw a relation the database does not declare, from a table (and columns) to another. */
    async relation(/** @type {unknown} */ id, /** @type {Record<string, unknown>} */ args = {}) {
      const t = diagrams.target(id);
      const graph = await diagrams.graphOf(t);
      const shown = graph.tables.filter((x) => shownOf(t).has(x.id));
      const from = await tableOf(args.from, shown, "Database: draw a relation from which table?");
      const to = await tableOf(args.to, shown, `Database: ${from[1]} refers to which table?`);
      const list = (/** @type {unknown} */ v) =>
        Array.isArray(v)
          ? v.map(String)
          : typeof v === "string" && v.trim()
            ? v.split(",").map((c) => c.trim())
            : undefined;
      const target = graph.tables.find((x) => x.id === idOf(...to));
      const columns =
        list(args.columns) ??
        list(
          await deps.pick(
            `Database: which columns of ${from[1]} refer to ${to[1]}? (none: leave empty)`,
            [{ id: " ", label: "No columns", detail: "Table to table" }],
            true,
            "customer_id",
          ),
        ) ??
        [];
      const refColumns =
        list(args.refColumns) ?? target?.columns.filter((c) => c.primary).map((c) => c.name) ?? [];
      const drawn = { from, to, columns, refColumns };
      await diagrams.redraw(t, (r) => ({ ...r, drawn: [...r.drawn, drawn] }));
      deps.say(`Drew ${drawnName(drawn)}, kept with this diagram and not in the database.`);
      return drawnName(drawn);
    },
    /** Take away a relation the person drew. */
    async unrelate(/** @type {unknown} */ id, /** @type {unknown} */ which) {
      const t = diagrams.target(id);
      const drawn = t.state.record.drawn;
      if (!drawn.length) throw new Error("This diagram has no drawn relations.");
      const names = drawn.map(drawnName);
      const picked =
        typeof which === "string" && names.includes(which)
          ? which
          : await deps.pick(
              "Database: remove which drawn relation?",
              names.map((name) => ({ id: name, label: name, detail: "Not in the database" })),
            );
      if (!picked) throw deps.cancelled("The diagram stays as it is.");
      await diagrams.redraw(t, (r) => ({
        ...r,
        drawn: r.drawn.filter((d) => drawnName(d) !== picked),
      }));
      return picked;
    },
  };
}
