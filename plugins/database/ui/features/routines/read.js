// A PostgreSQL routine as its form needs it, read from pg_catalog by the plugin itself (a read that
// asks nothing): the routines of the connection for the palette, and one routine's facts and
// arguments by its oid. Each argument comes with its name, mode, declared type (format_type, what a
// literal is cast to), its base type as the typed cell editors read one (a domain by its base, an
// array by its element, an enum's labels; ADR 0287) and its default (pg_get_function_arg_default,
// what information_schema.parameters uses). Pure but for the reader, which runs the queries through
// deps.execute.

import { parseArray } from "../../cell-editors/pg-array.js";
import { editorOf } from "../../cell-editors/resolve.js";
import { quoteText } from "../../sql/quote.js";
import { t } from "../../strings/index.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../cell-editors/resolve.js").Editor} Editor
 * @typedef {"i" | "o" | "b" | "v" | "t"} Mode
 *   IN, OUT, INOUT, VARIADIC and a RETURNS TABLE column, as pg_proc.proargmodes has them.
 * @typedef {{
 *   position: number, name: string, mode: Mode, type: string, typtype: string, typname: string,
 *   default: string | null, editor: Editor,
 * }} Arg
 *   `position` counts every argument from 1; `type` is the declared type as format_type writes
 *   it; `typtype` and `typname` are the declared type's own (p for a pseudo-type such as
 *   anyelement); `editor` edits its value by its base type.
 * @typedef {{
 *   oid: string, schema: string, name: string, kind: "function" | "procedure", prokind: string,
 *   volatility: "i" | "s" | "v", returnsSet: boolean, identity: string, result: string,
 *   language: string, returns: { typtype: string, typname: string }, controls: boolean,
 *   version: number, args: Arg[],
 * }} Routine
 *   `controls` says a procedure's source commits or rolls back (a word match on its body).
 * @typedef {{ oid: string, schema: string, name: string, identity: string, kind: string, result: string }} Listed
 */

const ROWS = 5000;
const q = (/** @type {string} */ value) => quoteText("postgresql", value);
const own =
  "p.prokind IN ('f', 'p') AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend e " +
  "WHERE e.objid = p.oid AND e.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass AND e.deptype = 'e')";
const system = "n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'";

/** The routines of a connection, or of one schema and name: oid, schema, name, arguments, kind, result. */
export function listSql(/** @type {{ schema?: string, name?: string, system?: boolean }} */ only) {
  const where = [
    own,
    ...(only.schema ? [`n.nspname = ${q(only.schema)}`] : only.system ? [] : [system]),
    ...(only.name ? [`p.proname = ${q(only.name)}`] : []),
  ];
  return (
    "SELECT p.oid::text, n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid), " +
    "CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END, " +
    "coalesce(pg_catalog.pg_get_function_result(p.oid), '') FROM pg_catalog.pg_proc p " +
    `JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE ${where.join(" AND ")} ` +
    "ORDER BY 2, 3, 4"
  );
}

const checked = (/** @type {string} */ oid) => {
  if (!/^\d+$/u.test(oid)) throw new Error(t("features.routines.read.thisRoutineHasNoCatalogId"));
  return oid;
};

/** One routine's facts: kind, volatility, set, identity, result, language, return type, control. */
export function factsSql(/** @type {string} */ oid) {
  // A procedure in a procedural language whose source names COMMIT or ROLLBACK may end the
  // transaction it runs in, so it must run outside a transaction block.
  const control = q("\\m(commit|rollback)\\M");
  return (
    "SELECT p.oid::text, n.nspname, p.proname, p.prokind::text, p.provolatile::text, " +
    "CASE WHEN p.proretset THEN 't' ELSE 'f' END, " +
    "pg_catalog.pg_get_function_identity_arguments(p.oid), " +
    "coalesce(pg_catalog.pg_get_function_result(p.oid), ''), l.lanname, " +
    "coalesce(t.typtype::text, ''), coalesce(t.typname::text, ''), " +
    "CASE WHEN p.prokind = 'p' AND l.lanname NOT IN ('sql', 'c', 'internal') AND " +
    `p.prosrc ~* ${control} THEN 't' ELSE 'f' END, ` +
    "pg_catalog.current_setting('server_version_num'), pg_catalog.current_setting('TimeZone') " +
    "FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace " +
    "JOIN pg_catalog.pg_language l ON l.oid = p.prolang " +
    `LEFT JOIN pg_catalog.pg_type t ON t.oid = p.prorettype WHERE p.oid = ${checked(oid)}`
  );
}

/** One routine's arguments, every mode, in their order, with the types the editors read. */
export function argsSql(/** @type {string} */ oid) {
  return (
    "SELECT a.n::text, coalesce(a.name, ''), coalesce(a.mode::text, 'i'), " +
    "pg_catalog.format_type(a.type, NULL), t.typtype::text, t.typname::text, b.typname::text, " +
    "b.typcategory::text, coalesce(e.typname::text, ''), coalesce(e.typcategory::text, ''), " +
    "ARRAY(SELECT l.enumlabel::text FROM pg_catalog.pg_enum l WHERE l.enumtypid = " +
    "CASE WHEN b.typtype = 'e' THEN b.oid ELSE e.oid END ORDER BY l.enumsortorder)::text, " +
    "pg_catalog.pg_get_function_arg_default(p.oid, a.n::integer) " +
    "FROM pg_catalog.pg_proc p CROSS JOIN LATERAL ROWS FROM (" +
    "pg_catalog.unnest(coalesce(p.proallargtypes, p.proargtypes::pg_catalog.oid[])), " +
    "pg_catalog.unnest(p.proargmodes), pg_catalog.unnest(p.proargnames)) " +
    "WITH ORDINALITY AS a(type, mode, name, n) JOIN pg_catalog.pg_type t ON t.oid = a.type " +
    "JOIN pg_catalog.pg_type b ON b.oid = CASE WHEN t.typtype = 'd' THEN t.typbasetype ELSE t.oid END " +
    "LEFT JOIN pg_catalog.pg_type e ON b.typcategory = 'A' AND e.oid = b.typelem " +
    `WHERE p.oid = ${checked(oid)} ORDER BY a.n`
  );
}

/** Pseudo-types a value can be given for once the person names the type it is. */
export const POLYMORPHIC = new Set([
  "any",
  "anyelement",
  "anyarray",
  "anynonarray",
  "anyenum",
  "anyrange",
  "anymultirange",
  "anycompatible",
  "anycompatiblearray",
  "anycompatiblenonarray",
  "anycompatiblerange",
  "anycompatiblemultirange",
  "record",
]);

/** The editor of a polymorphic argument: text, or a list of text for a VARIADIC one. */
const freeInfo = (/** @type {boolean} */ variadic) =>
  variadic
    ? { typname: "_text", category: "A", element: { typname: "text", category: "S" } }
    : { typname: "text", category: "S", element: null };

/**
 * The query's rows as the routine's arguments.
 * @param {(string | null)[][]} rows
 * @param {string} timeZone
 * @returns {Arg[]}
 */
export function argsOf(rows, timeZone = "") {
  return rows.map((row) => {
    const [n, name, mode, type, typtype, typname, base, category, element, elementCategory] = row;
    const labels = parseArray(row[10] ?? "{}");
    const free = typtype === "p" && POLYMORPHIC.has(typname ?? "");
    const resolved = free
      ? freeInfo(mode === "v")
      : {
          typname: base ?? "",
          category: category ?? "",
          element: element ? { typname: element, category: elementCategory ?? "" } : null,
        };
    const info = {
      type: free ? (mode === "v" ? "text[]" : "text") : (type ?? ""),
      ...resolved,
      labels: "elements" in labels ? labels.elements.map((l) => l ?? "") : [],
      nullable: false,
      hasDefault: false,
      generated: "",
      identity: "",
      timeZone,
    };
    const label = name || `$${n}`;
    return {
      position: Number(n),
      name: name ?? "",
      mode: /** @type {Mode} */ (mode || "i"),
      type: type ?? "",
      typtype: typtype ?? "",
      typname: typname ?? "",
      default: row[11] || null,
      editor: editorOf("postgresql", { name: label, type: info.type }, info),
    };
  });
}

/**
 * The facts row and the argument rows as a routine.
 * @param {(string | null)[]} facts
 * @param {(string | null)[][]} args
 * @returns {Routine}
 */
export function routineOf(facts, args) {
  const [oid, schema, name, prokind, volatility, set, identity, result, language] = facts;
  const timeZone = facts[13] ?? "";
  return {
    oid: oid ?? "",
    schema: schema ?? "",
    name: name ?? "",
    kind: prokind === "p" ? "procedure" : "function",
    prokind: prokind ?? "f",
    volatility: /** @type {Routine["volatility"]} */ (volatility || "v"),
    returnsSet: set === "t",
    identity: identity ?? "",
    result: result ?? "",
    language: language ?? "",
    returns: { typtype: facts[9] ?? "", typname: facts[10] ?? "" },
    controls: facts[11] === "t",
    version: Number(facts[12] ?? 0),
    args: argsOf(args, timeZone),
  };
}

/** The list query's rows. @returns {Listed[]} */
export const listedOf = (/** @type {(string | null)[][]} */ rows) =>
  rows.map(([oid, schema, name, identity, kind, result]) => ({
    oid: oid ?? "",
    schema: schema ?? "",
    name: name ?? "",
    identity: identity ?? "",
    kind: kind ?? "function",
    result: result ?? "",
  }));

/** A failure in words: its message, then its DETAIL and HINT lines. */
const wordsOf = (/** @type {{ message: string, detail?: string }} */ error) => {
  const more = (error.detail ?? "")
    .split("\n")
    .filter((line) => /^(?:DETAIL|HINT):/u.test(line))
    .map((line) => line.replace(/^[A-Z]+:\s*/u, "").trim())
    .join(" ");
  return more ? `${error.message}. ${more}` : error.message;
};

/** @param {{ execute: import("../../catalog.js").Execute }} deps */
export function createReader(deps) {
  const sets = async (/** @type {Connection} */ conn, /** @type {string[]} */ sqls) => {
    const { result } = await deps.execute(conn, sqls.join(";\n"), { catalog: true, maxRows: ROWS });
    const failed = result.error ?? result.statements.find((s) => s.error)?.error;
    if (failed) throw new Error(wordsOf(failed));
    return result.statements.map((s) => s.sets[0]?.rows ?? []);
  };
  return {
    /** The routines of the connection (its system schemas with `system`), or of a schema's name. */
    list: async (
      /** @type {Connection} */ conn,
      /** @type {{ schema?: string, name?: string, system?: boolean }} */ only,
    ) => listedOf((await sets(conn, [listSql(only)]))[0] ?? []),
    /** One routine by its oid; an Error when it is gone. */
    async routine(/** @type {Connection} */ conn, /** @type {string} */ oid) {
      const [facts = [], args = []] = await sets(conn, [factsSql(oid), argsSql(oid)]);
      if (!facts[0]) throw new Error(t("features.routines.read.thisRoutineIsGoneItWas"));
      return routineOf(facts[0], args);
    },
  };
}
