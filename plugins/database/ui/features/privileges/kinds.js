// What each kind of PostgreSQL object takes in GRANT and REVOKE (PG-54), one row a kind: the word
// its statement names it by (`ON TABLE`), the catalog its ACL is in with the ACL's and the owner's
// columns, acldefault's letter for a NULL ACL, how the catalog row is found, and the privileges in
// the order the matrix shows them (MAINTAIN only from PostgreSQL 17). Default privileges have their
// own five kinds. Pure.

import { qualified, quoteText } from "../../sql/quote.js";
import { t } from "../../strings/index.js";

/**
 * @typedef {{ kind: string, schema: string, name: string, table?: string, ident?: string }} Target
 *   An object by kind, schema and name ("" for one of the database or the server); `ident` a
 *   routine's oid.
 * @typedef {{
 *   on: string, label: string, catalog: string, acl: string, owner: string, letter: string,
 *   privileges: readonly string[], columns?: boolean, routine?: boolean, level?: boolean,
 * }} KindRow
 *   `on` is what GRANT names it by; `letter` acldefault's; `columns` that columns take grants of
 *   their own; `routine` that it is named by its arguments; `level` that it has no schema.
 */

const TABLE = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
];
const relation = (/** @type {string} */ label) => ({
  on: "TABLE",
  label,
  catalog: "pg_class",
  acl: "relacl",
  owner: "relowner",
  letter: "r",
  privileges: TABLE,
  columns: true,
});
const routine = (/** @type {string} */ on) => ({
  on,
  label: on.toLowerCase(),
  catalog: "pg_proc",
  acl: "proacl",
  owner: "proowner",
  letter: "f",
  privileges: ["EXECUTE"],
  routine: true,
});
const single = (
  /** @type {string} */ on,
  /** @type {string} */ catalog,
  /** @type {string} */ prefix,
  /** @type {string} */ letter,
  /** @type {string[]} */ privileges,
) => ({
  on,
  label: on.toLowerCase(),
  catalog,
  acl: `${prefix}acl`,
  owner: `${prefix}owner`,
  letter,
  privileges,
  level: true,
});

/** The kinds that hold privileges, by the explorer's word for them. */
export const KINDS = /** @type {Record<string, KindRow>} */ ({
  table: relation("table"),
  view: relation("view"),
  "materialized view": relation("materialized view"),
  "foreign table": relation("foreign table"),
  sequence: {
    on: "SEQUENCE",
    label: t("features.privileges.kinds.sequence"),
    catalog: "pg_class",
    acl: "relacl",
    owner: "relowner",
    letter: "s",
    privileges: ["USAGE", "SELECT", "UPDATE"],
  },
  function: routine("FUNCTION"),
  procedure: routine("PROCEDURE"),
  type: {
    on: "TYPE",
    label: t("features.privileges.kinds.type"),
    catalog: "pg_type",
    acl: "typacl",
    owner: "typowner",
    letter: "T",
    privileges: ["USAGE"],
  },
  schema: { ...single("SCHEMA", "pg_namespace", "nsp", "n", ["USAGE", "CREATE"]), level: false },
  database: {
    on: "DATABASE",
    label: t("features.privileges.kinds.database"),
    catalog: "pg_database",
    acl: "datacl",
    owner: "datdba",
    letter: "d",
    privileges: ["CONNECT", "CREATE", "TEMPORARY"],
    level: true,
  },
  language: single("LANGUAGE", "pg_language", "lan", "l", ["USAGE"]),
  "foreign data wrapper": single("FOREIGN DATA WRAPPER", "pg_foreign_data_wrapper", "fdw", "F", [
    "USAGE",
  ]),
  "foreign server": single("FOREIGN SERVER", "pg_foreign_server", "srv", "S", ["USAGE"]),
  tablespace: single("TABLESPACE", "pg_tablespace", "spc", "t", ["CREATE"]),
});

/** A kind's row, or undefined for a kind without privileges of its own. */
export const kindOf = (/** @type {string} */ kind) =>
  Object.hasOwn(KINDS, kind) ? KINDS[kind] : undefined;

/** The privileges a kind shows on a server's version (MAINTAIN from 17). */
export function privilegesOf(/** @type {string} */ kind, /** @type {number} */ version) {
  const row = kindOf(kind);
  if (!row) return [];
  return row.privileges.filter((p) => p !== "MAINTAIN" || version >= 170000);
}

/** The privileges a column takes. */
export const COLUMN_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "REFERENCES"];

/** Default privileges' kinds: pg_default_acl's letter, the word, the privileges. */
export const DEFAULT_KINDS = /** @type {const} */ ({
  r: { on: "TABLES", label: t("features.privileges.kinds.tables"), privileges: TABLE },
  S: {
    on: "SEQUENCES",
    label: t("features.privileges.kinds.sequences"),
    privileges: ["USAGE", "SELECT", "UPDATE"],
  },
  f: {
    on: "FUNCTIONS",
    label: t("features.privileges.kinds.functionsAndProcedures"),
    privileges: ["EXECUTE"],
  },
  T: { on: "TYPES", label: t("features.privileges.kinds.types"), privileges: ["USAGE"] },
  n: {
    on: "SCHEMAS",
    label: t("features.privileges.kinds.schemas"),
    privileges: ["USAGE", "CREATE"],
  },
});

/** A default privileges kind's privileges on a server's version. */
export function defaultPrivilegesOf(/** @type {string} */ letter, /** @type {number} */ version) {
  const row = Object.hasOwn(DEFAULT_KINDS, letter)
    ? DEFAULT_KINDS[/** @type {keyof typeof DEFAULT_KINDS} */ (letter)]
    : undefined;
  return (row?.privileges ?? []).filter((p) => p !== "MAINTAIN" || version >= 170000);
}

const PG = "postgresql";
const lit = (/** @type {string} */ text) => quoteText(PG, text);

/** The SQL condition that finds the target's catalog row as `x`. */
export function whereOf(/** @type {Target} */ target) {
  const row = kindOf(target.kind);
  if (!row)
    throw new Error(
      t("features.privileges.kinds.aHasNoPrivilegesOfIts", { kind: String(target.kind) }),
    );
  const name = qualified(PG, target.schema, target.name);
  switch (row.catalog) {
    case "pg_class":
      return `x.oid = pg_catalog.to_regclass(${lit(name)})`;
    case "pg_proc":
      if (!/^\d+$/u.test(target.ident ?? ""))
        throw new Error(
          t("features.privileges.kinds.hasNoCatalogId", { name: String(target.name) }),
        );
      return `x.oid = ${target.ident}::oid`;
    case "pg_type":
      return `x.oid = pg_catalog.to_regtype(${lit(name)})`;
    case "pg_database":
      return "x.datname = pg_catalog.current_database()";
    case "pg_namespace":
      return `x.nspname = ${lit(target.name)}`;
    default: {
      const column = { pg_language: "lanname", pg_tablespace: "spcname" }[row.catalog];
      return `x.${column ?? (row.catalog === "pg_foreign_server" ? "srvname" : "fdwname")} = ${lit(target.name)}`;
    }
  }
}

/** How an object is said: `table public.orders`, `database shop`. */
export function saidOf(/** @type {Target} */ target) {
  const row = kindOf(target.kind);
  const label = row?.label ?? target.kind;
  return row?.level || target.kind === "schema" || !target.schema
    ? `${label} ${target.name}`
    : `${label} ${target.schema}.${target.name}`;
}
