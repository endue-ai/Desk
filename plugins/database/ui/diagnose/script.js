// What a statement does to the statements after it in the same script, for the problems check
// (check.js, ADR 0294): SET search_path, RESET and set_config('search_path', ...) steer where names
// are looked for; SET ROLE changes `$user`; CREATE TABLE, VIEW, SEQUENCE, TABLE AS and SELECT INTO
// add a relation; ALTER TABLE makes its columns unknown; a rename or SET SCHEMA adds the new name; a
// new schema, an extension or IMPORT FOREIGN SCHEMA leaves a schema's contents unknown; DO, CALL and
// psql's \connect or \include leave everything after them unknown; COPY ... FROM STDIN ends what can
// be read. The script's state layers these over the schema cache's model (a copy of only what
// changed). Pure: it runs in the parse worker.
import { fieldsOf, kindOf, listOf, stringOf, walk } from "../sql/parse/tree.js";

/**
 * @typedef {import("../sql/parse/model.js").ModelIndex} ModelIndex
 * @typedef {import("../sql/parse/model.js").IndexedSchema} IndexedSchema
 * @typedef {import("../sql/parse/tree.js").Node} Node
 * @typedef {{ type: "path", path: string[] | null } | { type: "user", user: string | null }
 *   | { type: "reset" } | { type: "opaque" } | { type: "stop" }
 *   | { type: "relation", schema: string | null, name: string, kind: string, columns: string[] | null, temp?: boolean }
 *   | { type: "columns", schema: string | null, name: string }
 *   | { type: "rename", schema: string | null, name: string, to: string }
 *   | { type: "move", schema: string | null, name: string, to: string }
 *   | { type: "schema", name: string } | { type: "open", schema: string | null }} Effect
 *   `path` null and `user` null go back to what the check started with.
 * @typedef {{
 *   index: ModelIndex | undefined, base: ModelIndex | undefined, touched: Set<string>,
 *   path: string[], user: string, start: { path: string[], user: string },
 *   open: Set<string>, version: string, opaque: boolean, stopped: boolean,
 * }} State
 */

export const DEFAULT_PATH = Object.freeze(["$user", "public"]);
const TEMP = "pg_temp";

/** A schema list as set_config and the configuration take it: commas, quotes kept, others lowered. */
export function pathOf(/** @type {string} */ value) {
  /** @type {string[]} */
  const out = [];
  const re = /\s*(?:"((?:[^"]|"")*)"|([^,\s]+))\s*(?:,|$)/gy;
  let match = re.exec(value);
  while (match && match[0] !== "") {
    out.push(
      match[1] !== undefined ? match[1].replaceAll('""', '"') : (match[2] ?? "").toLowerCase(),
    );
    match = re.exec(value);
  }
  return out;
}

/** The path as the server shows it: names that need quotes in double quotes. */
export function pathText(/** @type {string[]} */ path) {
  if (path.length === 0) return "search path is empty";
  const quoted = path.map((s) =>
    /^[a-z_][a-z0-9_]*$/u.test(s) ? s : `"${s.replaceAll('"', '""')}"`,
  );
  return `search path: ${quoted.join(", ")}`;
}

const constOf = (/** @type {unknown} */ node) => fieldsOf(node, "A_Const")?.sval?.sval;
const rangeVar = (/** @type {Node | undefined} */ rv) => ({
  schema: rv?.schemaname ?? null,
  name: rv?.relname ?? "",
  temp: rv?.relpersistence === "t",
});

/** A CREATE TABLE's columns when they are all written there (no LIKE, INHERITS, OF or PARTITION OF). */
function columnsOf(/** @type {Node} */ f) {
  if (listOf(f.inhRelations).length > 0 || f.ofTypename || f.partbound) return null;
  /** @type {string[]} */
  const names = [];
  for (const element of listOf(f.tableElts)) {
    const column = fieldsOf(element, "ColumnDef");
    if (column) names.push(column.colname ?? "");
    else if (kindOf(element) === "TableLikeClause") return null;
  }
  return names;
}

/** set_config('search_path', '...', ...) anywhere in a statement. */
function setConfigs(/** @type {Node} */ root) {
  /** @type {Effect[]} */
  const found = [];
  walk(root, (kind, f) => {
    if (kind !== "FuncCall") return;
    const name = listOf(f.funcname).map((p) => stringOf(p));
    if (name[name.length - 1] !== "set_config") return;
    const [key, value] = listOf(f.args).map(constOf);
    if (key?.toLowerCase() === "search_path" && typeof value === "string")
      found.push({ type: "path", path: pathOf(value) });
  });
  return found;
}

/**
 * What one statement's tree does to the statements after it.
 * @param {Node} tree @returns {Effect[]}
 */
export function effectsOf(tree) {
  const kind = kindOf(tree);
  const f = tree[kind] ?? {};
  if (kind === "VariableSetStmt") {
    const name = String(f.name ?? "").toLowerCase();
    if (f.kind === "VAR_RESET_ALL") return [{ type: "reset" }];
    const back = f.kind === "VAR_RESET" || f.kind === "VAR_SET_DEFAULT";
    const args = listOf(f.args).map(constOf);
    if (name === "search_path")
      return [{ type: "path", path: back ? null : args.filter((a) => typeof a === "string") }];
    if (name === "role" || name === "session_authorization") {
      const user = back || args[0] === "none" ? null : (args[0] ?? null);
      return [{ type: "user", user }];
    }
    return [];
  }
  if (kind === "DoStmt" || kind === "CallStmt") return [{ type: "opaque" }];
  if (kind === "CopyStmt") return f.is_from && !f.filename ? [{ type: "stop" }] : [];
  if (kind === "CreateStmt" || kind === "CreateForeignTableStmt") {
    const base = kind === "CreateStmt" ? f : (f.base ?? {});
    const rv = rangeVar(base.relation);
    // IF NOT EXISTS may keep a table of other columns.
    const columns = base.if_not_exists ? null : columnsOf(base);
    return [{ type: "relation", ...rv, kind: "table", columns }];
  }
  if (kind === "ViewStmt")
    return [{ type: "relation", ...rangeVar(f.view), kind: "view", columns: null }];
  if (kind === "CreateSeqStmt")
    return [{ type: "relation", ...rangeVar(f.sequence), kind: "sequence", columns: null }];
  if (kind === "CreateTableAsStmt")
    return [{ type: "relation", ...rangeVar(f.into?.rel), kind: "table", columns: null }];
  if (kind === "SelectStmt" && f.intoClause)
    return [{ type: "relation", ...rangeVar(f.intoClause.rel), kind: "table", columns: null }];
  if (kind === "AlterTableStmt") {
    const { schema, name } = rangeVar(f.relation);
    return [{ type: "columns", schema, name }];
  }
  if (kind === "RenameStmt") {
    const { schema, name } = rangeVar(f.relation);
    if (f.renameType === "OBJECT_SCHEMA") return [{ type: "schema", name: f.newname ?? "" }];
    if (!f.relation) return [];
    if (f.renameType === "OBJECT_COLUMN") return [{ type: "columns", schema, name }];
    return [{ type: "rename", schema, name, to: f.newname ?? "" }];
  }
  if (kind === "AlterObjectSchemaStmt" && f.relation) {
    const { schema, name } = rangeVar(f.relation);
    return [{ type: "move", schema, name, to: f.newschema ?? "" }];
  }
  if (kind === "CreateSchemaStmt") return [{ type: "schema", name: f.schemaname ?? "" }];
  if (kind === "CreateExtensionStmt" || kind === "AlterExtensionStmt") {
    const option = listOf(f.options)
      .map((o) => fieldsOf(o, "DefElem"))
      .find((o) => o?.defname === "schema");
    return [{ type: "open", schema: stringOf(option?.arg) ?? null }];
  }
  if (kind === "ImportForeignSchemaStmt") return [{ type: "open", schema: f.local_schema ?? null }];
  return setConfigs(tree);
}

/** Schemas holding a partitioned table: the cache leaves partitions out, so any name may be one. */
const openOf = new WeakMap();
function partitioned(/** @type {ModelIndex | undefined} */ index) {
  if (!index) return new Set();
  let found = openOf.get(index);
  if (found) return found;
  found = new Set();
  for (const [name, schema] of index)
    for (const entry of schema.relations?.values() ?? [])
      if (/** @type {{ partitioned?: boolean }} */ (entry.relation).partitioned) found.add(name);
  openOf.set(index, found);
  return found;
}

/** @returns {State} */
export function createState(
  /** @type {ModelIndex | undefined} */ index,
  /** @type {string[]} */ path,
  /** @type {string} */ user,
) {
  return {
    index,
    base: index,
    touched: new Set(),
    path,
    user,
    start: { path, user },
    open: new Set(partitioned(index)),
    version: "",
    opaque: false,
    stopped: false,
  };
}

/** The path the resolver walks: pg_temp first when the script made a temporary relation. */
export const searchPathOf = (/** @type {State} */ state) =>
  state.index?.has(TEMP) && state.touched.has(TEMP) ? [TEMP, ...state.path] : state.path;

/** Where an unqualified CREATE puts its object: the first schema of the path that exists. */
function creationSchema(/** @type {State} */ state) {
  for (const s of state.path) {
    const name = s === "$user" ? state.user : s;
    if (name && name !== "pg_catalog" && state.index?.has(name)) return name;
  }
  return undefined;
}

/** A schema of the state's own index, copied from the model the first time it changes. */
function own(/** @type {State} */ state, /** @type {string} */ name) {
  if (!state.index) return undefined;
  if (state.index === state.base) state.index = new Map(state.base);
  const index = /** @type {ModelIndex} */ (state.index);
  if (!state.touched.has(name)) {
    const held = index.get(name);
    index.set(name, {
      name,
      relations: held ? (held.relations ? new Map(held.relations) : null) : new Map(),
      routines: held?.routines ?? new Map(),
    });
    state.touched.add(name);
  }
  return /** @type {IndexedSchema} */ (index.get(name));
}

/** Adds a relation (columns by name, or unknown). */
function add(state, schema, name, kind, columns) {
  const held = own(state, schema);
  if (!held?.relations || !name) return;
  const listed = columns?.map((c) => ({ name: c }));
  held.relations.set(name, {
    relation: { name, kind, ...(listed ? { columns: listed } : {}) },
    columns: listed ? new Map(listed.map((c) => [c.name, c])) : null,
  });
}

/** Applies one effect to the state; the version changes with whatever the index or path became. */
export function apply(/** @type {State} */ state, /** @type {Effect} */ effect) {
  let at = "";
  if (effect.type === "path") state.path = effect.path ?? state.start.path;
  else if (effect.type === "user") state.user = effect.user ?? state.start.user;
  else if (effect.type === "reset") Object.assign(state, state.start);
  else if (effect.type === "opaque") state.opaque = true;
  else if (effect.type === "stop") state.stopped = true;
  else if (effect.type === "schema") {
    own(state, effect.name);
    const held = state.index?.get(effect.name);
    if (held) held.relations = null;
    at = effect.name;
  } else if (effect.type === "open") {
    at = effect.schema ?? creationSchema(state) ?? "";
    if (at) state.open.add(at);
  } else {
    const temp = effect.type === "relation" && effect.temp;
    at = temp ? TEMP : (effect.schema ?? creationSchema(state) ?? "");
    if (!at) return;
    if (effect.type === "relation") add(state, at, effect.name, effect.kind, effect.columns);
    else if (effect.type === "columns" || effect.type === "rename" || effect.type === "move") {
      const found = state.index?.get(at)?.relations?.get(effect.name)?.relation;
      const kind = found?.kind ?? "table";
      if (effect.type === "columns") add(state, at, effect.name, kind, null);
      else if (effect.type === "rename") add(state, at, effect.to, kind, null);
      else add(state, effect.to, effect.name, kind, null);
    }
  }
  if (effect.type !== "path" && effect.type !== "user")
    state.version = mix(state.version, `${JSON.stringify(effect)}@${at}`);
}

/** Two 32-bit string hashes, folded into the running version. */
function mix(/** @type {string} */ version, /** @type {string} */ text) {
  let a = 2166136261;
  let b = 5381;
  const all = `${version}|${text}`;
  for (let i = 0; i < all.length; i++) {
    const c = all.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = (Math.imul(b, 33) + c) >>> 0;
  }
  return `${a.toString(36)}.${b.toString(36)}`;
}
