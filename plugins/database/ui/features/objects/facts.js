// What is read of an object before its dialog (PG-52), in one catalog run: a routine's name and
// arguments, its comment and owner, the roles to give it to, what depends on it (PostgreSQL's
// pg_depend, followed through what a drop takes along, a view's rule read as its view), the
// tables whose foreign keys a truncate meets, whether a materialized view can refresh
// CONCURRENTLY, a trigger's state and its function's source. Only the catalog is read, never rows.
// `factsSql` and `factsOf` are pure; `readFacts` runs them.

import { qualified, quoteText } from "../../sql/quote.js";
import { t as messageText } from "../../strings/index.js";
import { kindSql } from "./kinds.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./kinds.js").Target} Target
 * @typedef {import("./kinds.js").Op | import("./kinds.js").ApplyOp} AnyOp
 * @typedef {import("./sql-postgres.js").Facts} Facts
 * @typedef {import("./sql-postgres.js").Param} Param
 * @typedef {{ key: string, sql: string }} Read
 * @typedef {(string | null)[][]} Rows
 */

const PG = "postgresql";
const lit = (/** @type {string} */ value) => quoteText(PG, value);
const oidOf = (/** @type {string} */ name) => `'pg_catalog.${name}'::pg_catalog.regclass::oid`;
export const LISTED = 200;

/** The catalog row of the object as (c, o): its catalog's oid and its own. */
export function rootSql(/** @type {Target} */ target) {
  const spec = kindSql(PG, target.kind);
  const table = lit(qualified(PG, target.schema, target.table ?? ""));
  switch (spec?.catalog) {
    case "pg_class":
      return `SELECT ${oidOf("pg_class")} AS c, pg_catalog.to_regclass(${lit(qualified(PG, target.schema, target.name))})::oid AS o`;
    case "pg_proc":
      if (!/^\d+$/u.test(target.ident ?? ""))
        throw new Error(messageText("features.objects.facts.thisRoutineHasNoCatalogId"));
      return `SELECT ${oidOf("pg_proc")} AS c, ${target.ident}::oid AS o`;
    case "pg_trigger":
      return `SELECT ${oidOf("pg_trigger")} AS c, t.oid AS o FROM pg_catalog.pg_trigger t WHERE t.tgrelid = pg_catalog.to_regclass(${table}) AND t.tgname = ${lit(target.name)}`;
    case "pg_constraint":
      return `SELECT ${oidOf("pg_constraint")} AS c, k.oid AS o FROM pg_catalog.pg_constraint k WHERE k.conrelid = pg_catalog.to_regclass(${table}) AND k.conname = ${lit(target.name)}`;
    case "pg_namespace":
      return `SELECT ${oidOf("pg_namespace")} AS c, n.oid AS o FROM pg_catalog.pg_namespace n WHERE n.nspname = ${lit(target.name)}`;
    default:
      throw new Error(
        messageText("features.objects.facts.aSCatalogRowIsNot", { kind: String(target.kind) }),
      );
  }
}

/**
 * Every object a DROP ... CASCADE would take, as PostgreSQL decides it: what goes with the object
 * anyway (`auto`: its parts through auto and internal dependencies) and what an ordinary dependency
 * reaches beyond that, which a plain DROP is refused for. Each row: type, identity, whether it is
 * of the second kind, and how many rows there are. A part internal to another (a row type, a
 * constraint's index or triggers) is not listed, and of what goes along only the object's own
 * indexes, constraints, triggers, policies and sequences are; a rule is read as its view.
 */
export function dependentsSql(/** @type {Target} */ target) {
  const rewrite = oidOf("pg_rewrite");
  const own = ["pg_class", "pg_constraint", "pg_trigger", "pg_policy"].map(oidOf).join(", ");
  /** One step from `t` along `kinds` of dependency, a view's rule read as its view (not its own). */
  const step = (/** @type {string} */ t, /** @type {string} */ kinds, /** @type {string} */ more) =>
    `SELECT CASE WHEN d.classid = ${rewrite} THEN ${oidOf("pg_class")} ELSE d.classid END, ` +
    `coalesce(r.ev_class, d.objid)${more} FROM ${t} JOIN pg_catalog.pg_depend d ON d.refclassid = ` +
    `${t}.c AND d.refobjid = ${t}.o LEFT JOIN pg_catalog.pg_rewrite r ON d.classid = ${rewrite} AND ` +
    `r.oid = d.objid WHERE d.deptype IN (${kinds}) AND r.ev_class IS DISTINCT FROM ${t}.o`;
  return (
    `WITH RECURSIVE root AS (${rootSql(target)}), auto(c, o) AS (SELECT c, o FROM root UNION ` +
    `${step("auto", "'a', 'i', 'P', 'S'", "")}), every(c, o, normal, part) AS (SELECT c, o, false, ` +
    `false FROM auto UNION ${step("every", "'n', 'a', 'i', 'P', 'S'", ", d.deptype = 'n', d.deptype = 'i'")}) ` +
    "SELECT i.type, i.identity, (a.o IS NULL)::text, (pg_catalog.count(*) OVER ())::text FROM " +
    "(SELECT c, o, pg_catalog.bool_or(normal) AS normal, pg_catalog.bool_or(part) AS part FROM " +
    "every GROUP BY c, o) e CROSS JOIN root LEFT JOIN (SELECT DISTINCT c, o FROM auto) a ON a.c = " +
    "e.c AND a.o = e.o CROSS JOIN LATERAL pg_catalog.pg_identify_object(e.c, e.o, 0) i WHERE NOT " +
    "(e.c = root.c AND e.o = root.o) AND NOT e.part AND i.identity IS NOT NULL AND i.schema IS " +
    `DISTINCT FROM 'pg_toast' AND CASE WHEN a.o IS NULL THEN e.normal ELSE e.c IN (${own}) END ` +
    `ORDER BY 3 DESC, 1, 2 LIMIT ${LISTED}`
  );
}

const OWNERS = { pg_class: "relowner", pg_proc: "proowner", pg_namespace: "nspowner" };
const CATALOG_IDS = { pg_class: "oid", pg_proc: "oid", pg_namespace: "oid" };

/** The PostgreSQL reads an operation needs before its dialog. */
function postgresReads(/** @type {AnyOp} */ op, /** @type {Target} */ target) {
  const spec = kindSql(PG, target.kind);
  const root = `WITH root AS (${rootSql(target)}) `;
  /** @type {Read[]} */
  const reads = [];
  if (spec?.routine)
    reads.push({
      key: "routine",
      sql:
        "SELECT p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid), p.pronargs::text, " +
        "pg_catalog.array_to_json(p.proargnames)::text, pg_catalog.array_to_json(p.proargmodes)::text " +
        `FROM pg_catalog.pg_proc p, root WHERE p.oid = root.o`,
    });
  if (op === "drop" || (op === "apply" && target.kind === "materialized view"))
    reads.push({ key: "dependents", sql: dependentsSql(target) });
  if (op === "comment")
    reads.push({
      key: "comment",
      sql: "SELECT d.description FROM root LEFT JOIN pg_catalog.pg_description d ON d.classoid = root.c AND d.objoid = root.o AND d.objsubid = 0",
    });
  const catalog = /** @type {keyof typeof OWNERS} */ (spec?.catalog ?? "");
  if (op === "owner" && Object.hasOwn(OWNERS, catalog)) {
    reads.push({
      key: "owner",
      sql: `SELECT pg_catalog.pg_get_userbyid(x.${OWNERS[catalog]}) FROM pg_catalog.${catalog} x, root WHERE x.${CATALOG_IDS[catalog]} = root.o`,
    });
    reads.push({
      key: "roles",
      sql: "SELECT r.rolname FROM pg_catalog.pg_roles r WHERE r.rolname !~ '^pg_' ORDER BY 1 LIMIT 500",
    });
  }
  if (op === "truncate")
    reads.push({
      key: "truncate",
      sql:
        "SELECT pg_catalog.array_to_json(ARRAY(SELECT DISTINCT k.conrelid::pg_catalog.regclass::text " +
        "FROM pg_catalog.pg_constraint k WHERE k.contype = 'f' AND k.confrelid = root.o AND " +
        "k.conrelid <> root.o ORDER BY 1))::text, pg_catalog.array_to_json(ARRAY(SELECT " +
        "s.oid::pg_catalog.regclass::text FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class s ON " +
        `s.oid = d.objid AND s.relkind = 'S' WHERE d.classid = ${oidOf("pg_class")} AND d.refobjid = ` +
        "root.o AND d.deptype IN ('a', 'i') ORDER BY 1))::text, (SELECT CASE WHEN c.reltuples >= 0 " +
        "THEN c.reltuples::bigint::text END FROM pg_catalog.pg_class c WHERE c.oid = root.o) FROM root",
    });
  if (op === "refresh")
    reads.push({
      key: "refresh",
      sql:
        "SELECT c.relispopulated::text, EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE " +
        "i.indrelid = c.oid AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND " +
        "i.indexprs IS NULL)::text FROM pg_catalog.pg_class c, root WHERE c.oid = root.o",
    });
  if (op === "enable")
    reads.push({
      key: "enabled",
      sql: "SELECT t.tgenabled::text FROM pg_catalog.pg_trigger t, root WHERE t.oid = root.o",
    });
  if (op === "source" && target.kind === "trigger")
    reads.push({
      key: "function",
      sql:
        "SELECT pg_catalog.pg_get_functiondef(t.tgfoid), n.nspname, p.proname, t.tgfoid::text, " +
        "pg_catalog.pg_get_function_identity_arguments(p.oid) FROM root JOIN pg_catalog.pg_trigger t " +
        "ON t.oid = root.o JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN " +
        "pg_catalog.pg_namespace n ON n.oid = p.pronamespace",
    });
  return reads.map((read) =>
    read.key === "dependents" ? read : { ...read, sql: root + read.sql },
  );
}

/** MySQL's: a table's or a routine's comment, a routine's arguments. */
function mysqlReads(/** @type {AnyOp} */ op, /** @type {Target} */ target) {
  const where = (/** @type {string} */ s, /** @type {string} */ n) =>
    `${s} = ${quoteText("mysql", target.schema)} AND ${n} = ${quoteText("mysql", target.name)}`;
  const routine = target.kind === "function" || target.kind === "procedure";
  /** @type {Read[]} */
  const reads = [];
  if (op === "comment" && target.kind === "table")
    reads.push({
      key: "comment",
      sql: `SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE ${where("TABLE_SCHEMA", "TABLE_NAME")}`,
    });
  if (op === "comment" && routine)
    reads.push({
      key: "comment",
      sql: `SELECT ROUTINE_COMMENT FROM information_schema.ROUTINES WHERE ${where("ROUTINE_SCHEMA", "ROUTINE_NAME")}`,
    });
  if (op === "generate" && routine)
    reads.push({
      key: "params",
      sql: `SELECT PARAMETER_NAME, PARAMETER_MODE FROM information_schema.PARAMETERS WHERE ${where("SPECIFIC_SCHEMA", "SPECIFIC_NAME")} AND ORDINAL_POSITION > 0 ORDER BY ORDINAL_POSITION`,
    });
  return reads;
}

/** What an operation reads first, by engine; SQLite's catalog has nothing more to say. */
export function factsSql(
  /** @type {import("../../engines/common.js").EngineId} */ engine,
  /** @type {AnyOp} */ op,
  /** @type {Target} */ target,
) {
  if (engine === "postgresql") return postgresReads(op, target);
  return engine === "mysql" ? mysqlReads(op, target) : [];
}

const json = (/** @type {string | null | undefined} */ text) => {
  try {
    const value = JSON.parse(text ?? "");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};
const MODES = /** @type {Record<string, Param["mode"]>} */ ({
  i: "in",
  o: "out",
  b: "inout",
  v: "variadic",
  IN: "in",
  OUT: "out",
  INOUT: "inout",
});

/**
 * The facts from each read's rows, in the reads' order.
 * @param {Read[]} reads
 * @param {Rows[]} rows
 * @param {Target} target
 * @returns {Facts & { source?: string, fn?: Target }}
 */
export function factsOf(reads, rows, target) {
  /** @type {Facts & { source?: string, fn?: Target }} */
  const facts = {};
  reads.forEach(({ key }, i) => {
    const got = rows[i] ?? [];
    const first = got[0] ?? [];
    if (key === "routine") {
      const [name, args, count, names, modes] = first;
      const given = json(modes);
      const all = given.length ? given : Array.from({ length: Number(count ?? 0) }, () => "i");
      const labels = json(names);
      facts.routine = {
        name: name ?? target.name,
        args: args ?? "",
        params: all.flatMap((mode, at) =>
          mode === "t" ? [] : [{ name: String(labels[at] ?? ""), mode: MODES[mode] ?? "in" }],
        ),
      };
    } else if (key === "params")
      facts.routine = {
        name: target.name,
        args: "",
        params: got.map(([name, mode]) => ({ name: name ?? "", mode: MODES[mode ?? ""] ?? "in" })),
      };
    else if (key === "dependents") {
      const listed = got.map(([kind, name, needs]) => ({
        kind: kind ?? "",
        name: name ?? "",
        needs,
      }));
      facts.dependents = {
        blocking: listed
          .filter((d) => d.needs === "true")
          .map(({ kind, name }) => ({ kind, name })),
        along: listed.filter((d) => d.needs !== "true").map(({ kind, name }) => ({ kind, name })),
        more: Math.max(0, Number(first[3] ?? 0) - listed.length),
      };
    } else if (key === "comment") facts.comment = first[0] ?? null;
    else if (key === "owner") facts.owner = first[0] ?? "";
    else if (key === "roles") facts.roles = got.map((row) => row[0] ?? "").filter(Boolean);
    else if (key === "truncate") {
      facts.referencing = json(first[0]).map(String);
      facts.sequences = json(first[1]).map(String);
      facts.rows =
        first[2] === null || first[2] === undefined || first[2] === "" ? null : Number(first[2]);
    } else if (key === "refresh") {
      facts.populated = first[0] === "true";
      facts.unique = first[1] === "true";
    } else if (key === "enabled") facts.enabled = first[0] ?? "O";
    else if (key === "function" && first[0]) {
      facts.source = first[0];
      facts.fn = {
        kind: "function",
        schema: first[1] ?? "",
        name: `${first[2]}(${first[4] ?? ""})`,
        ident: first[3] ?? "",
      };
    }
  });
  return facts;
}

/**
 * Read an operation's facts in one catalog run; a failure says the server's words.
 * @param {{ execute: import("../../catalog.js").Execute }} deps
 * @param {Connection} conn
 * @param {AnyOp} op
 * @param {Target} target
 */
export async function readFacts(deps, conn, op, target) {
  const reads = factsSql(conn.engine, op, target);
  if (reads.length === 0) return {};
  const run = await deps.execute(conn, reads.map((r) => r.sql).join(";\n"), {
    catalog: true,
    maxRows: 1000,
  });
  const { result } = run;
  const failed = result.error ?? result.statements.find((s) => s.error)?.error;
  if (failed)
    throw new Error(
      messageText("features.objects.facts.notRead", { message: String(failed.message) }),
    );
  return factsOf(
    reads,
    result.statements.map((s) => s.sets[0]?.rows ?? []),
    target,
  );
}
