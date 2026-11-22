// One PostgreSQL schema read as a model (PG-53, ADR 0338): its reads (read-sql.js) run one after the
// other as catalog runs of deps.execute, each told to `progress`, and Cancel (the run's `signal`)
// stops between them and inside one; then every table built by the table form's designOf from its
// rows, and the other objects from theirs (objects.js). `modelOfRows` is pure.

import { designOf, factsOf } from "../table-design/read.js";
import {
  compositeObj,
  domainObj,
  enumObj,
  routineObj,
  sequenceObj,
  tableObj,
  triggerObj,
  viewObj,
} from "./objects.js";
import { plainOf } from "./plain.js";
import { schemaReads } from "./read-sql.js";
import { argTypes, typeDdl, typed } from "./types.js";

/**
 * @typedef {(string | null)[][]} Rows
 * @typedef {import("./model.js").Model} Model
 * @typedef {import("./model.js").Obj} Obj
 * @typedef {import("../table-design/read.js").Facts} Facts
 * @typedef {{ done: number, total: number, what: string }} Progress
 */

/** As many rows as a read may bring: past it the schema is not read whole, and says so. */
export const MAX_ROWS = 1_000_000;
const text = (/** @type {string | null | undefined} */ v) => v ?? "";
const json = (/** @type {string | null | undefined} */ v) => {
  try {
    const parsed = JSON.parse(v || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** Rows by the oid their last field names. */
function byTable(/** @type {Rows} */ rows) {
  /** @type {Map<string, Rows>} */
  const out = new Map();
  for (const row of rows) {
    const oid = text(row.at(-1));
    out.set(oid, [...(out.get(oid) ?? []), row]);
  }
  return out;
}

/**
 * A schema's model from its reads' rows, by key.
 * @param {string} schema
 * @param {Record<string, Rows>} rows
 * @returns {{ model: Model, facts: Facts }}
 */
export function modelOfRows(schema, rows) {
  const facts = factsOf({
    version: rows["server.version"] ?? [],
    types: rows["server.types"] ?? [],
    casts: rows["server.casts"] ?? [],
    roles: rows["server.roles"] ?? [],
    methods: rows["server.methods"] ?? [],
  });
  const ours = new Set((rows.types ?? []).map((r) => text(r[0])));
  const where = { own: schema, ours };
  /** @type {Obj[]} */
  const objects = [];
  const parts = {
    table: byTable(rows["table.table"] ?? []),
    columns: byTable(rows["table.columns"] ?? []),
    constraints: byTable(rows["table.constraints"] ?? []),
    indexes: byTable(rows["table.indexes"] ?? []),
  };
  for (const [oid, name] of rows.tables ?? []) {
    const id = text(oid);
    const got = designOf(
      schema,
      text(name),
      {
        table: parts.table.get(id) ?? [],
        columns: parts.columns.get(id) ?? [],
        constraints: parts.constraints.get(id) ?? [],
        indexes: parts.indexes.get(id) ?? [],
      },
      facts,
    );
    const partition = got.partitioned.replace(/^(range|list|hash)/iu, (m) => m.toUpperCase());
    objects.push(tableObj(plainOf(got.design, schema), partition, facts));
  }
  for (const [name, kind, body] of rows.views ?? [])
    objects.push(
      viewObj(kind === "m" ? "materialized view" : "view", schema, text(name), text(body)),
    );
  for (const [name, type, start, increment, min, max, cache, cycle] of rows.sequences ?? [])
    objects.push(
      sequenceObj(schema, text(name), {
        type: text(type),
        start: text(start),
        increment: text(increment),
        min: text(min),
        max: text(max),
        cache: text(cache),
        cycle: cycle === "true",
      }),
    );
  for (const [name, args, kind, ddl] of rows.routines ?? [])
    objects.push(
      routineObj(
        text(name),
        argTypes(text(args), where),
        kind === "p" ? "procedure" : "function",
        text(ddl),
      ),
    );
  for (const [name, kind, what, def, notNull, checks] of rows.types ?? []) {
    if (kind === "e") objects.push(enumObj(schema, text(name), json(what).map(String)));
    else if (kind === "c")
      objects.push(
        compositeObj(
          schema,
          text(name),
          json(what).map(
            (a) =>
              /** @type {[string, string]} */ ([String(a[0]), typeDdl(typed(String(a[1]), where))]),
          ),
        ),
      );
    else
      objects.push(
        domainObj(schema, text(name), {
          base: typeDdl(typed(text(what), where)),
          default: text(def),
          notNull: notNull === "true",
          checks: json(checks).map((c) => ({ name: String(c[0]), sql: String(c[1]) })),
        }),
      );
  }
  for (const [table, name, ddl] of rows.triggers ?? [])
    objects.push(triggerObj(text(table), text(name), text(ddl)));
  /** @type {Model} */
  const model = { format: 1, schema, objects };
  return { model, facts };
}

/**
 * Read a schema of a connection.
 * @param {{ execute: import("../../catalog.js").Execute, cancelled(message: string): Error }} deps
 * @param {import("../../engines/common.js").Connection} conn
 * @param {string} schema
 * @param {{ signal?: AbortSignal, progress?(p: Progress): void }} [how]
 */
export async function readSchema(deps, conn, schema, { signal, progress } = {}) {
  const reads = schemaReads(schema);
  const server = reads.filter((r) => r.key.startsWith("server."));
  const batches = [server, ...reads.filter((r) => !r.key.startsWith("server.")).map((r) => [r])];
  /** @type {Record<string, Rows>} */
  const rows = {};
  for (const [i, batch] of batches.entries()) {
    if (signal?.aborted) throw deps.cancelled("Not compared.");
    progress?.({
      done: i,
      total: batches.length,
      what: batch.length > 1 ? "the server" : (batch[0]?.key ?? ""),
    });
    const run = await deps.execute(conn, batch.map((r) => r.sql).join(";\n"), {
      catalog: true,
      maxRows: MAX_ROWS,
      ...(signal ? { signal } : {}),
    });
    if (signal?.aborted) throw deps.cancelled("Not compared.");
    const { result } = run;
    const failed = result.error ?? result.statements.find((s) => s.error)?.error;
    if (failed) throw new Error(`${conn.name}: ${schema} was not read: ${failed.message}`);
    batch.forEach((read, k) => {
      const set = result.statements[k]?.sets[0];
      if (set?.truncated)
        throw new Error(
          `${schema} on ${conn.name} has more than ${MAX_ROWS} rows of ${read.key}: it is not compared.`,
        );
      rows[read.key] = set?.rows ?? [];
    });
  }
  progress?.({ done: batches.length, total: batches.length, what: "" });
  return modelOfRows(schema, rows);
}
