// A schema's types (PG-50): enums with their labels, composite types with their attributes, domains
// with their base, default and checks, ranges with their subtype, and base types with their I/O
// functions. One statement for every schema of a pass; an array type, a table's row type and an
// extension's types are left out. The DDL is built from the cached row, a base type's with its I/O
// functions read on `d` (their bodies are never cached). Pure.

import { assemble, commentOn, dotted, ident, literal } from "./ddl.js";
import { described, inSchemas, json, markOf, notMember } from "./sql.js";

/**
 * @typedef {import("../common.js").SchemaObject} SchemaObject
 * @typedef {(string | null)[]} Row
 */

const TYPTYPE = /** @type {Record<string, string>} */ ({
  e: "enum",
  c: "composite",
  d: "domain",
  r: "range",
  b: "base",
});
const nonzero = (/** @type {string} */ column, /** @type {string} */ cast = "regproc") =>
  `CASE WHEN ${column} <> 0 THEN ${column}::pg_catalog.${cast}::text END`;

const DETAIL =
  "CASE t.typtype WHEN 'e' THEN (SELECT pg_catalog.json_agg(e.enumlabel ORDER BY e.enumsortorder) " +
  "FROM pg_catalog.pg_enum e WHERE e.enumtypid = t.oid) WHEN 'c' THEN (SELECT pg_catalog.json_agg(" +
  "pg_catalog.json_build_array(a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), CASE WHEN " +
  "a.attcollation <> at.typcollation THEN a.attcollation::pg_catalog.regcollation::text END) ORDER BY " +
  "a.attnum) FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type at ON at.oid = a.atttypid WHERE " +
  "a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped) WHEN 'd' THEN " +
  "pg_catalog.json_build_object('base', pg_catalog.format_type(t.typbasetype, t.typtypmod), 'default', " +
  "pg_catalog.pg_get_expr(t.typdefaultbin, 0), 'notNull', t.typnotnull, 'collation', CASE WHEN " +
  "t.typcollation <> bt.typcollation THEN t.typcollation::pg_catalog.regcollation::text END, 'checks', " +
  "(SELECT pg_catalog.json_agg(pg_catalog.json_build_array(k.conname, pg_catalog.pg_get_constraintdef(" +
  "k.oid, true)) ORDER BY k.conname) FROM pg_catalog.pg_constraint k WHERE k.contypid = t.oid AND " +
  "k.contype = 'c')) WHEN 'r' THEN (SELECT pg_catalog.json_build_object('subtype', " +
  "pg_catalog.format_type(r.rngsubtype, NULL), 'opclass', CASE WHEN NOT o.opcdefault THEN " +
  "pg_catalog.json_build_array(opn.nspname, o.opcname) END, 'collation', CASE WHEN r.rngcollation <> 0 " +
  "AND r.rngcollation <> st.typcollation THEN r.rngcollation::pg_catalog.regcollation::text END, " +
  `'canonical', ${nonzero("r.rngcanonical")}, 'subdiff', ${nonzero("r.rngsubdiff")}, 'multirange', ` +
  "(SELECT m.typname FROM pg_catalog.pg_type m WHERE m.oid = (pg_catalog.to_jsonb(r) ->> " +
  "'rngmultitypid')::oid)) FROM pg_catalog.pg_range r JOIN pg_catalog.pg_type st ON st.oid = " +
  "r.rngsubtype JOIN pg_catalog.pg_opclass o ON o.oid = r.rngsubopc JOIN pg_catalog.pg_namespace opn " +
  "ON opn.oid = o.opcnamespace WHERE r.rngtypid = t.oid) WHEN 'b' THEN pg_catalog.json_build_object(" +
  `'input', ${nonzero("t.typinput")}, 'output', ${nonzero("t.typoutput")}, 'receive', ` +
  `${nonzero("t.typreceive")}, 'send', ${nonzero("t.typsend")}, 'typmodIn', ${nonzero("t.typmodin")}, ` +
  `'typmodOut', ${nonzero("t.typmodout")}, 'analyze', ${nonzero("t.typanalyze")}, 'subscript', ` +
  "nullif(pg_catalog.to_jsonb(t) ->> 'typsubscript', '-'), 'length', t.typlen, 'byValue', t.typbyval, " +
  "'align', t.typalign, 'storage', t.typstorage, 'category', t.typcategory, 'preferred', " +
  "t.typispreferred, 'default', t.typdefault, 'element', CASE WHEN t.typelem <> 0 THEN " +
  "pg_catalog.format_type(t.typelem, NULL) END, 'delimiter', t.typdelim, 'collatable', " +
  "t.typcollation <> 0) END::text";

/** @type {import("../../schema-cache/kinds.js").Kind} */
export const reader = {
  id: "types",
  label: "types",
  marks: [
    markOf(
      "pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid",
      "t.typnamespace",
      "e",
    ),
    markOf(
      "pg_catalog.pg_description d JOIN pg_catalog.pg_type t ON t.oid = d.objoid AND d.classoid = " +
        "'pg_catalog.pg_type'::pg_catalog.regclass",
      "t.typnamespace",
      "d",
    ),
  ],
  sql: (schemas) =>
    `SELECT n.nspname, t.typname, t.typtype::text, ${DETAIL}, pg_catalog.pg_get_userbyid(t.typowner), ` +
    "t.oid::text, d.description FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = " +
    "t.typnamespace LEFT JOIN pg_catalog.pg_type bt ON bt.oid = t.typbasetype " +
    `${described("pg_type", "t.oid")} WHERE ${inSchemas(schemas)} AND t.typtype IN ('b', 'c', 'd', ` +
    "'e', 'r') AND (t.typrelid = 0 OR (SELECT c.relkind FROM pg_catalog.pg_class c WHERE c.oid = " +
    "t.typrelid) = 'c') AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_type y WHERE y.typarray = t.oid) " +
    `AND ${notMember("pg_type", "t.oid")} ORDER BY 1, 2`,
};

/** The schema's types from the reader's rows (name, typtype, detail, owner, oid, comment). */
export function objectsOf(/** @type {Row[]} */ rows, /** @type {string} */ schema) {
  return rows.map(([name, typtype, detail, owner, oid, comment]) => {
    const def = json(detail);
    const kind = TYPTYPE[typtype ?? ""] ?? "base";
    const shown =
      kind === "domain"
        ? `domain of ${def.base ?? ""}`
        : kind === "range"
          ? `range of ${def.subtype ?? ""}`
          : kind;
    return /** @type {SchemaObject} */ ({
      schema,
      name: name ?? "",
      kind: "type",
      detail: shown,
      rows: null,
      ident: oid ?? "",
      owner: owner ?? "",
      comment: comment ?? "",
      def: { typtype: kind, ...(Array.isArray(def) ? { list: def } : def) },
    });
  });
}

const ALIGN = /** @type {Record<string, string>} */ ({
  c: "char",
  s: "int2",
  i: "int4",
  d: "double",
});
const STORAGE = /** @type {Record<string, string>} */ ({
  p: "plain",
  e: "external",
  m: "main",
  x: "extended",
});
const lines = (/** @type {string[]} */ items) => `(\n    ${items.join(",\n    ")}\n)`;

/** The queries a type's DDL needs on `d`: a base type's I/O functions in its own schema. */
export function ddlQueries(/** @type {SchemaObject} */ object) {
  if (object.def?.typtype !== "base") return [];
  if (!/^\d+$/u.test(object.ident)) throw new Error("This type has no catalog id.");
  return [
    "SELECT pg_catalog.pg_get_functiondef(p.oid) FROM pg_catalog.pg_type t JOIN pg_catalog.pg_proc " +
      "p ON p.oid IN (t.typinput, t.typoutput, t.typreceive, t.typsend) AND p.pronamespace = " +
      `t.typnamespace WHERE t.oid = ${object.ident}::oid ORDER BY p.oid`,
  ];
}

/**
 * CREATE TYPE (or CREATE DOMAIN) from the cached row, its comment after it.
 * @param {SchemaObject} object
 * @param {(string | null)[][][]} [results] A base type's I/O functions.
 */
export function ddl(object, results = []) {
  const def = /** @type {Record<string, any>} */ (object.def ?? {});
  const name = dotted(object.schema, object.name);
  const kind = def.typtype;
  /** @type {string[]} */
  const out = [];
  if (kind === "enum")
    out.push(`CREATE TYPE ${name} AS ENUM ${lines((def.list ?? []).map(literal))};\n`);
  else if (kind === "composite")
    out.push(
      `CREATE TYPE ${name} AS ${lines(
        (def.list ?? []).map(
          (/** @type {string[]} */ [attr, type, coll]) =>
            `${ident(attr ?? "")} ${type}${coll ? ` COLLATE ${coll}` : ""}`,
        ),
      )};\n`,
    );
  else if (kind === "domain") {
    const parts = [
      ...(def.collation ? [`COLLATE ${def.collation}`] : []),
      ...(def.default ? [`DEFAULT ${def.default}`] : []),
      ...(def.notNull ? ["NOT NULL"] : []),
      ...(def.checks ?? []).map(
        (/** @type {string[]} */ [check, text]) => `CONSTRAINT ${ident(check ?? "")} ${text}`,
      ),
    ];
    out.push(`CREATE DOMAIN ${name} AS ${def.base}${parts.map((p) => `\n    ${p}`).join("")};\n`);
  } else if (kind === "range") {
    const items = [`SUBTYPE = ${def.subtype}`];
    if (def.opclass) items.push(`SUBTYPE_OPCLASS = ${dotted(def.opclass[0], def.opclass[1])}`);
    if (def.collation) items.push(`COLLATION = ${def.collation}`);
    if (def.canonical) items.push(`CANONICAL = ${def.canonical}`);
    if (def.subdiff) items.push(`SUBTYPE_DIFF = ${def.subdiff}`);
    if (def.multirange)
      items.push(`MULTIRANGE_TYPE_NAME = ${dotted(object.schema, def.multirange)}`);
    out.push(`CREATE TYPE ${name} AS RANGE ${lines(items)};\n`);
  } else out.push(...baseDdl(name, def, results));
  const what = kind === "domain" ? "DOMAIN" : "TYPE";
  return assemble(object.owner, out, commentOn(what, name, object.comment));
}

/** A base type: its shell, its I/O functions, then the type. */
function baseDdl(
  /** @type {string} */ name,
  /** @type {Record<string, any>} */ def,
  /** @type {(string | null)[][][]} */ results,
) {
  const items = [`INPUT = ${def.input}`, `OUTPUT = ${def.output}`];
  for (const [key, word] of /** @type {const} */ ([
    ["receive", "RECEIVE"],
    ["send", "SEND"],
    ["typmodIn", "TYPMOD_IN"],
    ["typmodOut", "TYPMOD_OUT"],
    ["analyze", "ANALYZE"],
    ["subscript", "SUBSCRIPT"],
  ]))
    if (def[key]) items.push(`${word} = ${def[key]}`);
  items.push(`INTERNALLENGTH = ${Number(def.length) < 0 ? "VARIABLE" : def.length}`);
  if (def.byValue) items.push("PASSEDBYVALUE");
  items.push(
    `ALIGNMENT = ${ALIGN[def.align] ?? "int4"}`,
    `STORAGE = ${STORAGE[def.storage] ?? "plain"}`,
  );
  if (def.category && def.category !== "U") items.push(`CATEGORY = ${literal(def.category)}`);
  if (def.preferred) items.push("PREFERRED = true");
  if (def.default !== null && def.default !== undefined)
    items.push(`DEFAULT = ${literal(def.default)}`);
  if (def.element) items.push(`ELEMENT = ${def.element}`);
  if (def.delimiter && def.delimiter !== ",") items.push(`DELIMITER = ${literal(def.delimiter)}`);
  if (def.collatable) items.push("COLLATABLE = true");
  const functions = (results[0] ?? []).map(
    (row) => `${(row[0] ?? "").trim().replace(/;$/u, "")};\n`,
  );
  return [`CREATE TYPE ${name};\n`, ...functions, `CREATE TYPE ${name} ${lines(items)};\n`];
}
