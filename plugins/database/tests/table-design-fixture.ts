// A scripted PostgreSQL server for the table form (ui/features/table-design/), over the fixture shop
// (pg-catalog.ts): the server's version, types (pg_catalog's and app.mood, an enum, and
// public.positive, a domain over integer), casts, roles and index methods, and the designs of
// public.people and public.orders as read-sql.js reads them. The DDL a run sends is recorded and
// left to the rest of the page to answer. The unit tests and the runtime e2e page
// (packages/runtime/e2e/fixture/database.ts) share it; it needs no Node. Fixture data only.
import { factsOf } from "../ui/features/table-design/read.js";
import type { Answer, Script } from "./clients";

type Row = (string | null)[];

/** oid, schema, name, as PostgreSQL formats it, takes a length, category, a domain's base. */
// biome-ignore format: one type a line
export const TYPES: string[][] = [
  ["16", "pg_catalog", "bool", "boolean", "false", "B", "0"],
  ["20", "pg_catalog", "int8", "bigint", "false", "N", "0"],
  ["21", "pg_catalog", "int2", "smallint", "false", "N", "0"],
  ["23", "pg_catalog", "int4", "integer", "false", "N", "0"],
  ["25", "pg_catalog", "text", "text", "false", "S", "0"],
  ["1043", "pg_catalog", "varchar", "character varying", "true", "S", "0"],
  ["1082", "pg_catalog", "date", "date", "false", "D", "0"],
  ["1184", "pg_catalog", "timestamptz", "timestamp with time zone", "true", "D", "0"],
  ["1700", "pg_catalog", "numeric", "numeric", "true", "N", "0"],
  ["2950", "pg_catalog", "uuid", "uuid", "false", "U", "0"],
  ["3802", "pg_catalog", "jsonb", "jsonb", "false", "U", "0"],
  ["90001", "app", "mood", "app.mood", "false", "E", "0"],
  ["90002", "public", "positive", "positive", "false", "N", "23"],
];

/** Implicit and assignment casts: source, target, method (b: binary coercible). */
// biome-ignore format: one cast a line
export const CASTS: string[][] = [
  ["21", "23", "f"], ["23", "20", "f"], ["20", "23", "f"], ["23", "1700", "f"],
  ["1700", "23", "f"], ["20", "1700", "f"], ["25", "1043", "b"], ["1043", "25", "b"],
  ["1082", "1184", "f"],
];
export const ROLES = ["app", "reports"];
export const METHODS = ["brin", "btree", "gin", "gist", "hash"];

/** The facts the form reads of this server, as read.js makes them. */
export const shopFacts = (version = "170006") =>
  factsOf({
    version: [[version]],
    types: TYPES,
    casts: CASTS,
    roles: ROLES.map((r) => [r]),
    methods: METHODS.map((m) => [m]),
  });

/** A column's row as read-sql.js reads it. */
export function column(
  num: number,
  name: string,
  label: string,
  more: {
    length?: string;
    notNull?: boolean;
    identity?: string;
    expression?: string;
    comment?: string;
  } = {},
): Row {
  const type = TYPES.find((t) => t[3] === label || `${t[1]}.${t[2]}` === label) ?? [];
  return [
    String(num),
    name,
    ...type.slice(0, 7),
    "false",
    more.length ?? "",
    String(more.notNull ?? false),
    more.identity ?? "",
    "",
    more.expression ?? "",
    more.comment ?? "",
  ].map((v) => v ?? "");
}

export interface Table {
  table: Row;
  columns: Row[];
  constraints: Row[];
  indexes: Row[];
}

/** What each table of the shop reads as. */
// biome-ignore format: rows as the server answers them
export const TABLES: Record<string, Table> = {
  "public.people": {
    table: ["16401", "r", "app", "Who buys", "", "false"],
    columns: [
      column(1, "id", "integer", { notNull: true, expression: "nextval('people_id_seq'::regclass)" }),
      column(2, "name", "text", { notNull: true, comment: "Full name" }),
      column(3, "joined", "timestamp with time zone", { expression: "now()" }),
    ],
    constraints: [["16410", "p", "people_pkey", "[1]", "", "", "", "[]", "a", "a", "false", "PRIMARY KEY (id)", "false"]],
    indexes: [["16411", "people_name", "btree", "false", '[[2,""]]', "", "false", "CREATE INDEX people_name ON public.people USING btree (name)"]],
  },
  "public.orders": {
    table: ["16402", "r", "app", "", "", "false"],
    columns: [
      column(1, "id", "integer", { notNull: true, identity: "a" }),
      column(2, "person", "integer"),
      column(3, "total", "numeric", { length: "10,2" }),
    ],
    constraints: [
      ["16420", "c", "orders_total_check", "[3]", "total >= 0::numeric", "", "", "[]", " ", " ", "false", "CHECK (total >= 0::numeric)", "false"],
      ["16421", "f", "orders_person_fkey", "[2]", "", "public", "people", '["id"]', "a", "a", "false", "FOREIGN KEY (person) REFERENCES people(id)", "false"],
      ["16422", "p", "orders_pkey", "[1]", "", "", "", "[]", "a", "a", "false", "PRIMARY KEY (id)", "false"],
    ],
    indexes: [],
  },
  "public.big_orders": {
    table: ["16403", "v", "app", "", "", "false"],
    columns: [column(1, "id", "integer")],
    constraints: [],
    indexes: [],
  },
};

const header = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
const rows = (list: Row[], n: number): Answer => ({ rows: [header(n), ...list] });

/** The table a read names in its to_regclass('"schema"."name"'). */
function tableOf(sql: string) {
  const literal = /to_regclass\('((?:[^']|'')*)'\)/u.exec(sql)?.[1]?.replaceAll("''", "'") ?? "";
  return literal
    .split(/(?<=")\.(?=")/u)
    .map((p) => p.replace(/^"|"$/gu, "").replaceAll('""', '"'))
    .join(".");
}

/** The form's reads of `tables`, or undefined for another statement. */
export function designRead(
  sql: string,
  tables: Record<string, Table> = TABLES,
  version = "170006",
): Answer | undefined {
  if (sql.startsWith("SELECT pg_catalog.current_setting('server_version_num') AS version"))
    return rows([[version]], 1);
  if (sql.startsWith("SELECT t.oid::text, n.nspname, t.typname")) return rows(TYPES, 7);
  if (sql.startsWith("SELECT c.castsource::text")) return rows(CASTS, 3);
  if (sql.startsWith("SELECT r.rolname FROM pg_catalog.pg_roles r WHERE r.rolname !~"))
    return rows(
      ROLES.map((r) => [r]),
      1,
    );
  if (sql.startsWith("SELECT a.amname FROM pg_catalog.pg_am a"))
    return rows(
      METHODS.map((m) => [m]),
      1,
    );
  const found = tables[tableOf(sql)];
  if (sql.startsWith("SELECT c.oid::text, c.relkind::text, pg_catalog.pg_get_userbyid"))
    return rows(found ? [found.table] : [], 6);
  if (sql.startsWith("SELECT a.attnum::text, a.attname, b.oid::text AS type"))
    return rows(found?.columns ?? [], 16);
  if (sql.startsWith("SELECT k.oid::text, k.contype::text, k.conname"))
    return rows(found?.constraints ?? [], 13);
  if (sql.startsWith("SELECT i.indexrelid::text, ic.relname, am.amname"))
    return rows(found?.indexes ?? [], 8);
  return undefined;
}

/**
 * The scripted server; `other` answers every statement that is not the form's reads. `tables` is
 * its own copy, so a test adds the table a run created; `ran` holds each DDL statement sent.
 */
export function tableDesignServer(other: Script = () => ({})) {
  const ran: string[] = [];
  const tables: Record<string, Table> = structuredClone(TABLES);
  const script: Script = (sql, who) => {
    const text = sql.trim();
    if (!who.database) return other(sql, who);
    const read = designRead(text, tables);
    if (read) return read;
    if (/^(--[^\n]*\n)*\s*(ALTER|CREATE|COMMENT|DROP)\b/u.test(text)) ran.push(text);
    return other(sql, who);
  };
  return { script, ran, tables };
}
