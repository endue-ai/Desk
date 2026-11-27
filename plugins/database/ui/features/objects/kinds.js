import { t } from "../../strings/index.js";

// What each engine can do to each kind of object from the explorer (PG-52): a row per kind, with
// the word its DDL names it by, the catalog its dependents are read from (PostgreSQL's pg_depend),
// whether it is named on its table (a trigger, a constraint) or by its arguments (a routine), and
// the operations it takes. A kind the explorer learns later (PG-50) joins with one row; the
// statements (sql-postgres.js, sql-other.js) are written from these fields alone. Pure.

/**
 * @typedef {"rename" | "move" | "owner" | "comment" | "drop" | "truncate" | "refresh" | "enable" | "source" | "generate"} Op
 * @typedef {"apply"} ApplyOp The source edited in a console, run (source.js).
 * @typedef {{
 *   word: string, label: string, catalog?: string, on?: boolean, routine?: boolean,
 *   constraint?: boolean, ops: readonly Op[],
 * }} KindSql
 *   `word` is what DDL calls it (`MATERIALIZED VIEW`); `label` how it is said; `catalog` the system
 *   catalog its row is in, for its dependents; `on` that its name is its table's (`t ON s.tab`);
 *   `routine` that it is named by its arguments; `constraint` that ALTER TABLE renames and drops it.
 * @typedef {{ kind: string, schema: string, name: string, table?: string, ident?: string, owned?: boolean }} Target
 *   An object (`table`, `function`, `schema` ...) or a table's part (`index`, `trigger`, a
 *   constraint's kind) by its schema and name; `table` the table a part is on; `ident` a routine's
 *   oid; `owned` an index a constraint owns.
 */

const RELATION = ["rename", "move", "owner", "comment", "drop"];
const constraint = (/** @type {string} */ label) => ({
  word: "CONSTRAINT",
  label,
  catalog: "pg_constraint",
  on: true,
  constraint: true,
  ops: /** @type {Op[]} */ (["rename", "comment", "drop"]),
});
const routine = (/** @type {string} */ word) => ({
  word,
  label: word.toLowerCase(),
  catalog: "pg_proc",
  routine: true,
  ops: /** @type {Op[]} */ (["source", ...RELATION, "generate"]),
});

/** PostgreSQL's kinds. */
const POSTGRES = /** @type {Record<string, KindSql>} */ ({
  table: {
    word: "TABLE",
    label: t("features.objects.kinds.table"),
    catalog: "pg_class",
    ops: [...RELATION, "truncate", "generate"],
  },
  "foreign table": {
    word: "FOREIGN TABLE",
    label: t("features.objects.kinds.foreignTable"),
    catalog: "pg_class",
    ops: [...RELATION, "generate"],
  },
  view: {
    word: "VIEW",
    label: t("features.objects.kinds.view"),
    catalog: "pg_class",
    ops: ["source", ...RELATION, "generate"],
  },
  "materialized view": {
    word: "MATERIALIZED VIEW",
    label: t("features.objects.kinds.materializedView"),
    catalog: "pg_class",
    ops: ["refresh", "source", ...RELATION, "generate"],
  },
  sequence: {
    word: "SEQUENCE",
    label: t("features.objects.kinds.sequence"),
    catalog: "pg_class",
    ops: RELATION,
  },
  function: routine("FUNCTION"),
  procedure: routine("PROCEDURE"),
  index: {
    word: "INDEX",
    label: t("features.objects.kinds.index"),
    catalog: "pg_class",
    ops: ["rename", "comment", "drop"],
  },
  trigger: {
    word: "TRIGGER",
    label: t("features.objects.kinds.trigger"),
    catalog: "pg_trigger",
    on: true,
    ops: ["source", "enable", "rename", "comment", "drop"],
  },
  "primary key": constraint("primary key"),
  unique: constraint("unique constraint"),
  check: constraint("check constraint"),
  exclusion: constraint("exclusion constraint"),
  "foreign key": constraint("foreign key"),
  constraint: constraint("constraint"),
  schema: {
    word: "SCHEMA",
    label: t("features.objects.kinds.schema"),
    catalog: "pg_namespace",
    ops: ["rename", "owner", "comment", "drop"],
  },
});

/** MySQL's and MariaDB's: what their DDL can say of each. */
const MYSQL = /** @type {Record<string, KindSql>} */ ({
  table: {
    word: "TABLE",
    label: t("features.objects.kinds.table"),
    ops: ["rename", "move", "comment", "drop", "truncate", "generate"],
  },
  view: {
    word: "VIEW",
    label: t("features.objects.kinds.view"),
    ops: ["source", "rename", "drop", "generate"],
  },
  sequence: {
    word: "SEQUENCE",
    label: t("features.objects.kinds.sequence"),
    ops: ["rename", "drop"],
  },
  function: {
    word: "FUNCTION",
    label: t("features.objects.kinds.function"),
    ops: ["comment", "drop", "generate"],
  },
  procedure: {
    word: "PROCEDURE",
    label: t("features.objects.kinds.procedure"),
    ops: ["comment", "drop", "generate"],
  },
  event: { word: "EVENT", label: t("features.objects.kinds.event"), ops: ["rename", "drop"] },
  index: {
    word: "INDEX",
    label: t("features.objects.kinds.index"),
    on: true,
    ops: ["rename", "drop"],
  },
  trigger: { word: "TRIGGER", label: t("features.objects.kinds.trigger"), ops: ["drop"] },
  "primary key": {
    word: "PRIMARY KEY",
    label: t("features.objects.kinds.primaryKey"),
    on: true,
    ops: ["drop"],
  },
  unique: {
    word: "INDEX",
    label: t("features.objects.kinds.uniqueConstraint"),
    on: true,
    ops: ["drop"],
  },
  check: {
    word: "CHECK",
    label: t("features.objects.kinds.checkConstraint"),
    on: true,
    ops: ["drop"],
  },
  "foreign key": {
    word: "FOREIGN KEY",
    label: t("features.objects.kinds.foreignKey"),
    on: true,
    ops: ["drop"],
  },
});

/** SQLite's: a table renamed, dropped or emptied; a view, an index and a trigger dropped. */
const SQLITE = /** @type {Record<string, KindSql>} */ ({
  table: {
    word: "TABLE",
    label: t("features.objects.kinds.table"),
    ops: ["rename", "drop", "truncate", "generate"],
  },
  view: {
    word: "VIEW",
    label: t("features.objects.kinds.view"),
    ops: ["source", "drop", "generate"],
  },
  index: { word: "INDEX", label: t("features.objects.kinds.index"), ops: ["drop"] },
  trigger: { word: "TRIGGER", label: t("features.objects.kinds.trigger"), ops: ["drop"] },
});

/** @type {Record<import("../../engines/common.js").EngineId, Record<string, KindSql>>} */
export const KINDS = { postgresql: POSTGRES, mysql: MYSQL, sqlite: SQLITE };

export const ENGINE_NAMES = { postgresql: "PostgreSQL", mysql: "MySQL", sqlite: "SQLite" };

/** What the menu calls each operation, and the verb a status line says it with. */
export const OPS = /** @type {const} */ ({
  source: { label: t("features.objects.kinds.editTheSource"), done: "Opened the source of" },
  refresh: { label: t("features.objects.kinds.refresh"), done: "Refreshed" },
  enable: { label: t("features.objects.kinds.enableOrDisable"), done: "Changed" },
  rename: { label: t("features.objects.kinds.rename"), done: "Renamed" },
  move: { label: t("features.objects.kinds.moveToAnotherSchema"), done: "Moved" },
  owner: { label: t("features.objects.kinds.changeTheOwner"), done: "Changed the owner of" },
  comment: { label: t("features.objects.kinds.comment"), done: "Commented" },
  truncate: { label: t("features.objects.kinds.truncate"), done: "Truncated" },
  drop: { label: t("features.objects.kinds.drop"), done: "Dropped" },
  generate: { label: t("features.objects.kinds.generateSql"), done: "Generated SQL for" },
});

/**
 * A kind's row on an engine, or undefined.
 * @param {import("../../engines/common.js").EngineId} engine
 * @param {string} kind
 */
export const kindSql = (engine, kind) =>
  Object.hasOwn(KINDS[engine], kind) ? KINDS[engine][kind] : undefined;

/** The operations a kind takes on an engine, in the menu's order. */
export function opsOf(
  /** @type {import("../../engines/common.js").EngineId} */ engine,
  /** @type {string} */ kind,
) {
  const ops = kindSql(engine, kind)?.ops ?? [];
  return /** @type {Op[]} */ (
    Object.keys(OPS).filter((op) => ops.includes(/** @type {Op} */ (op)))
  );
}

/** How an object is said: `view public.orders`, `trigger touch on public.people`. */
export function said(
  /** @type {import("../../engines/common.js").EngineId} */ engine,
  /** @type {Target} */ target,
) {
  const label = kindSql(engine, target.kind)?.label ?? target.kind;
  if (target.kind === "schema") return `schema ${target.name}`;
  const where = engine === "sqlite" && target.schema === "main" ? "" : `${target.schema}.`;
  if (target.table) return `${label} ${target.name} on ${where}${target.table}`;
  return `${label} ${where}${target.name}`;
}

/** Why an operation is not offered for a kind on an engine, or "". */
export function notOffered(
  /** @type {import("../../engines/common.js").EngineId} */ engine,
  /** @type {Op} */ op,
  /** @type {Target} */ target,
) {
  if (opsOf(engine, target.kind).includes(op)) return "";
  const label = kindSql(engine, target.kind)?.label ?? target.kind;
  const what = OPS[op].label.replace(/…$/u, "");
  const ddl = op === "source" && target.kind !== "schema" ? ": d shows its DDL" : "";
  return t("features.objects.kinds.isNotOnForA", {
    what: String(what),
    value: String(ENGINE_NAMES[engine]),
    label: String(label),
    ddl: String(ddl),
  });
}
