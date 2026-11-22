// What the source search reads in a cached schema (PG-82): functions, procedures, views and
// materialized views by their bodies (read.js reads those the cache does not keep), and triggers,
// policies, checks and defaults from the cache as they are; with comments, the COMMENT ON texts of
// tables, columns and routines too. Each item's text is the one its source or DDL console shows
// (schema/postgres.js's ddl), so a matching line is that console's line; a default and a comment are
// searched for their expression or text alone, not the statement's own words around it. Pure.

import { ddl } from "../../schema/postgres.js";
import { qualified, quoteName, quoteText } from "../../sql/quote.js";

/**
 * @typedef {import("../../schema-cache/view.js").CacheView} CacheView
 * @typedef {import("../../schema/common.js").SchemaObject} SchemaObject
 * @typedef {import("./match.js").Range} Range
 * @typedef {"function" | "procedure" | "view" | "materialized view" | "trigger" | "policy" | "check" | "default" | "comment"} Kind
 * @typedef {{
 *   kind: Kind, schema: string, table: string, name: string, ident: string, text: string,
 *   skip: Range[],
 * }} Item
 *   `name` a routine's with its arguments, a default's or a column comment's column; `table` the
 *   table a part, a default or a column's comment is on; `skip` the statement's own words.
 * @typedef {{ routines: string[], views: string[] }} Need The oids and view names to read.
 */

/** The kinds the person picks from, in the order results are listed; comments come last. */
export const KINDS = /** @type {const} */ ([
  ["function", "Functions"],
  ["procedure", "Procedures"],
  ["view", "Views"],
  ["materialized view", "Materialized views"],
  ["trigger", "Triggers"],
  ["policy", "Policies"],
  ["check", "Checks"],
  ["default", "Defaults"],
]);
export const KIND_IDS = KINDS.map(([id]) => id);
const ORDER = /** @type {string[]} */ ([...KIND_IDS, "comment"]);
const VIEWS = new Set(["view", "materialized view"]);
const RELATIONS = new Set(["table", "view", "materialized view", "foreign table"]);
const PARTS = new Set(["trigger", "policy", "check"]);
const WORD = /** @type {Record<string, string>} */ ({
  table: "TABLE",
  view: "VIEW",
  "materialized view": "MATERIALIZED VIEW",
  "foreign table": "FOREIGN TABLE",
  sequence: "SEQUENCE",
});

const pg = "postgresql";
/** An item whose text is `prefix` then what is searched; the prefix's matches never count. */
const after = (/** @type {Omit<Item, "text" | "skip">} */ item, prefix = "", rest = "") => ({
  ...item,
  text: `${prefix}${rest}`,
  skip: /** @type {Range[]} */ (prefix ? [[0, prefix.length]] : []),
});

/** The order results are listed in: kind, then table, then name. */
export const byOrder = (/** @type {Item} */ a, /** @type {Item} */ b) =>
  ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) ||
  a.table.localeCompare(b.table) ||
  a.name.localeCompare(b.name);

/**
 * The bodies a schema's search needs: its routines' oids and its views' names, of the kinds asked.
 * @param {CacheView} view
 * @param {string} schema
 * @param {readonly string[]} kinds
 * @returns {Need}
 */
export function needOf(view, schema, kinds) {
  const routines = (view.routines(schema) ?? [])
    .filter((r) => kinds.includes(r.kind) && /^\d+$/u.test(r.ident))
    .map((r) => r.ident);
  const views = (view.objects(schema) ?? [])
    .filter((o) => VIEWS.has(o.kind) && kinds.includes(o.kind))
    .map((o) => o.name);
  return { routines, views };
}

/**
 * Every item of a held schema: bodies from `bodies` (`r:<oid>` a routine's pg_get_functiondef,
 * `v:<name>` a view's pg_get_viewdef; one missing is left out), the rest from the cache.
 * @param {CacheView} view
 * @param {string} schema
 * @param {{ kinds: readonly string[], comments: boolean }} options
 * @param {Map<string, string>} bodies
 * @returns {Item[]}
 */
export function itemsOf(view, schema, options, bodies) {
  const wanted = (/** @type {string} */ kind) => options.kinds.includes(kind);
  const objects = view.objects(schema) ?? [];
  /** @type {Item[]} */
  const items = [];
  const base = { schema, table: "", ident: "" };
  for (const r of view.routines(schema) ?? []) {
    const name = `${r.name}(${r.args})`;
    const def = bodies.get(`r:${r.ident}`);
    if (wanted(r.kind) && def)
      items.push(
        after(
          { ...base, kind: r.kind, name, ident: r.ident },
          "",
          ddlOf(r.kind, schema, name, def),
        ),
      );
    if (options.comments && r.comment)
      items.push(
        after(
          { ...base, kind: "comment", name, ident: r.ident },
          `COMMENT ON ${r.kind.toUpperCase()} ${qualified(pg, schema, r.name)}(${r.args}) IS `,
          `${quoteText(pg, r.comment)};\n`,
        ),
      );
  }
  for (const o of objects) {
    if (VIEWS.has(o.kind) && wanted(o.kind)) {
      const def = bodies.get(`v:${o.name}`);
      if (def)
        items.push(
          after(
            { ...base, kind: /** @type {Kind} */ (o.kind), name: o.name },
            "",
            ddlOf(o.kind, schema, o.name, def),
          ),
        );
    }
    if (!RELATIONS.has(o.kind)) continue;
    const table = qualified(pg, schema, o.name);
    for (const part of view.parts(schema, o.name) ?? [])
      if (PARTS.has(part.kind) && wanted(part.kind))
        items.push(
          after(
            { ...base, kind: /** @type {Kind} */ (part.kind), table: o.name, name: part.name },
            "",
            ddl(part, []),
          ),
        );
    const note = view.comment(schema, o.name);
    if (options.comments && note && WORD[o.kind])
      items.push(
        after(
          { ...base, kind: "comment", name: o.name },
          `COMMENT ON ${WORD[o.kind]} ${table} IS `,
          `${quoteText(pg, note)};\n`,
        ),
      );
    for (const c of view.columns(schema, o.name) ?? []) {
      const column = quoteName(pg, c.name);
      if (c.default && wanted("default"))
        items.push(
          after(
            { ...base, kind: "default", table: o.name, name: c.name },
            `ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT `,
            `${c.default};\n`,
          ),
        );
      if (options.comments && c.comment)
        items.push(
          after(
            { ...base, kind: "comment", table: o.name, name: c.name },
            `COMMENT ON COLUMN ${table}.${column} IS `,
            `${quoteText(pg, c.comment)};\n`,
          ),
        );
    }
  }
  return items.sort(byOrder);
}

/** A body as its source console shows it. */
function ddlOf(
  /** @type {string} */ kind,
  /** @type {string} */ schema,
  /** @type {string} */ name,
  /** @type {string} */ def,
) {
  /** @type {SchemaObject} */
  const object = {
    schema,
    name,
    kind: /** @type {SchemaObject["kind"]} */ (kind),
    detail: "",
    rows: null,
    ident: "",
  };
  return ddl(object, [[[def]]]);
}
