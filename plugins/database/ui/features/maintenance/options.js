// What the maintenance form offers: the operations a target takes and each operation's options on
// the server's version (PostgreSQL 13 and later), with the reason an option does not apply while
// another rules it out (VACUUM FULL rewrites the table, so PARALLEL, INDEX_CLEANUP, TRUNCATE,
// PROCESS_TOAST and BUFFER_USAGE_LIMIT have nothing to do). Options a caller sends are checked
// here before they reach the statement. Pure.

/**
 * @typedef {"database" | "schema" | "table" | "index"} TargetKind
 * @typedef {{ kind: TargetKind, schema: string, table: string, index: string }} Target
 *   `table` is empty for a schema and the database, and for an index until its table is read.
 * @typedef {"vacuum" | "analyze" | "reindex" | "cluster"} Operation
 * @typedef {"" | "auto" | "on" | "off"} Switch "" leaves the table's own setting.
 * @typedef {{
 *   full: boolean, freeze: boolean, verbose: boolean, analyze: boolean, skipLocked: boolean,
 *   indexCleanup: Switch, truncate: Switch, parallel: number | null, processToast: boolean,
 *   bufferUsageLimit: string, concurrently: boolean, tablespace: string, using: string,
 * }} Options
 *   `parallel` null lets the server choose; `using` is CLUSTER's index, `tablespace` REINDEX's.
 * @typedef {{ name: string, clustered: boolean, primary: boolean, valid: boolean, method: string, partial: boolean, bytes: number | null }} Index
 * @typedef {{ version: number, tablespaces: string[], indexes: Index[], relkind: string }} Known
 *   What the form knows of the server and the target (model.js's facts).
 * @typedef {{ key: keyof Options, label: string, type: "check" | "switch" | "number" | "text" | "pick", values: string[], why: string }} Offer
 *   `why` is "" when the option applies, else the sentence that says why not.
 */

export const OPERATIONS = /** @type {const} */ (["vacuum", "analyze", "reindex", "cluster"]);
export const TITLES = {
  vacuum: "VACUUM",
  analyze: "ANALYZE",
  reindex: "REINDEX",
  cluster: "CLUSTER",
};
const FOURTEEN = 140000;
const SIXTEEN = 160000;
const FIFTEEN = 150000;

/** @type {Options} */
export const DEFAULTS = {
  full: false,
  freeze: false,
  verbose: true,
  analyze: false,
  skipLocked: false,
  indexCleanup: "",
  truncate: "",
  parallel: null,
  processToast: true,
  bufferUsageLimit: "",
  concurrently: true,
  tablespace: "",
  using: "",
};

/** The operations a target takes, in the form's order. */
export function operationsFor(/** @type {TargetKind} */ kind) {
  if (kind === "schema") return ["vacuum", "analyze", "reindex"];
  if (kind === "index") return ["reindex", "cluster"];
  return [...OPERATIONS];
}

/** The option keys of each operation, in the order the form and the statement give them. */
const KEYS = {
  vacuum: /** @type {const} */ ([
    ...["full", "freeze", "verbose", "analyze", "skipLocked", "indexCleanup"],
    ...["truncate", "parallel", "processToast", "bufferUsageLimit"],
  ]),
  analyze: /** @type {const} */ (["verbose", "skipLocked", "bufferUsageLimit"]),
  reindex: /** @type {const} */ (["concurrently", "verbose", "tablespace"]),
  cluster: /** @type {const} */ (["verbose", "using"]),
};

export const LABELS = {
  full: "FULL",
  freeze: "FREEZE",
  verbose: "VERBOSE",
  analyze: "ANALYZE",
  skipLocked: "SKIP_LOCKED",
  indexCleanup: "INDEX_CLEANUP",
  truncate: "TRUNCATE",
  parallel: "PARALLEL",
  processToast: "PROCESS_TOAST",
  bufferUsageLimit: "BUFFER_USAGE_LIMIT",
  concurrently: "CONCURRENTLY",
  tablespace: "TABLESPACE",
  using: "USING index",
};

/** Indexes CLUSTER can order a table by: valid, whole, of an access method that keeps an order. */
export const clusterable = (/** @type {Index} */ i) =>
  i.valid && !i.partial && (i.method === "btree" || i.method === "gist");

/**
 * Whether an option is there on this version (null when not), and why it does not apply now.
 * @param {keyof Options} key
 * @param {Operation} op
 * @param {Target} target
 * @param {Known} known
 * @param {Options} o
 * @returns {string | null}
 */
export function applies(key, op, target, known, o) {
  const v = known.version;
  if (!(/** @type {readonly string[]} */ (KEYS[op]).includes(key))) return null;
  if (key === "processToast" && v < FOURTEEN) return null;
  if (key === "bufferUsageLimit" && v < SIXTEEN) return null;
  if (key === "tablespace" && v < FOURTEEN) return null;
  const full = op === "vacuum" && o.full;
  if (full && ["indexCleanup", "truncate", "parallel", "bufferUsageLimit"].includes(key))
    return "Not with FULL, which writes the table anew.";
  if (full && key === "processToast") return "FULL always processes the TOAST table.";
  if (key === "using" && target.kind === "index") return "The index this form is for.";
  if (key === "using" && target.kind === "database")
    return "The whole database: each table clustered before, by its own index.";
  if (key === "concurrently" && system(target))
    return "System catalogs cannot be reindexed concurrently.";
  return "";
}

/** A schema or table of the system catalogs. */
export const system = (/** @type {Target} */ t) =>
  (t.kind !== "database" && (t.schema === "pg_catalog" || t.schema === "pg_toast")) || false;

/** Whether an option is written into the statement: offered and not ruled out. */
export const on = (
  /** @type {keyof Options} */ key,
  /** @type {Operation} */ op,
  /** @type {Target} */ target,
  /** @type {Known} */ known,
  /** @type {Options} */ o,
) => applies(key, op, target, known, o) === "";

/**
 * The options the form shows for an operation, with what each may be.
 * @param {Operation} op
 * @param {Target} target
 * @param {Known} known
 * @param {Options} o
 * @returns {Offer[]}
 */
export function offered(op, target, known, o) {
  /** @type {Offer[]} */
  const out = [];
  for (const key of KEYS[op]) {
    const why = applies(key, op, target, known, o);
    if (why === null) continue;
    out.push({ key, label: LABELS[key], type: typeOf(key), values: valuesOf(key, known), why });
  }
  return out;
}

const typeOf = (/** @type {keyof Options} */ key) =>
  key === "indexCleanup" || key === "truncate"
    ? "switch"
    : key === "parallel"
      ? "number"
      : key === "bufferUsageLimit"
        ? "text"
        : key === "tablespace" || key === "using"
          ? "pick"
          : "check";

/** The values a switch or a pick may take ("" first: the table's setting, or none). */
function valuesOf(/** @type {keyof Options} */ key, /** @type {Known} */ known) {
  if (key === "indexCleanup")
    return known.version >= FOURTEEN ? ["", "auto", "on", "off"] : ["", "on", "off"];
  if (key === "truncate") return ["", "on", "off"];
  if (key === "tablespace") return ["", ...known.tablespaces];
  if (key === "using") return ["", ...known.indexes.filter(clusterable).map((i) => i.name)];
  return [];
}

/** CLUSTER of a partitioned table needs PostgreSQL 15. */
export const partitionedTooOld = (/** @type {Known} */ known) =>
  known.relkind === "p" && known.version < FIFTEEN;

/**
 * Options from a caller (the panel, the palette, an agent) checked against what they may be.
 * @param {Options} now
 * @param {Record<string, unknown>} patch
 * @param {Known | null} known what is read so far; picks are checked against it once read
 * @returns {Options}
 */
export function patched(now, patch, known) {
  const next = { ...now };
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULTS, key)) throw new Error(`No option is named ${key}.`);
    const name = LABELS[/** @type {keyof Options} */ (key)];
    const type = typeOf(/** @type {keyof Options} */ (key));
    if (type === "check") {
      if (typeof value !== "boolean") throw new Error(`${name} is on or off (true or false).`);
      Object.assign(next, { [key]: value });
    } else if (type === "switch") {
      if (!["", "auto", "on", "off"].includes(String(value)))
        throw new Error(`${name} is auto, on or off, or empty for the table's setting.`);
      Object.assign(next, { [key]: String(value) });
    } else if (type === "number") {
      const n = value === null || value === "" ? null : Number(value);
      if (n !== null && (!Number.isInteger(n) || n < 0 || n > 1024))
        throw new Error("PARALLEL takes 0 to 1024 workers, or nothing to let the server choose.");
      next.parallel = n;
    } else if (type === "text") {
      const text = String(value ?? "").trim();
      if (text !== "" && !/^\d+ ?(kB|MB|GB)?$/u.test(text))
        throw new Error("BUFFER_USAGE_LIMIT is a size such as 256kB, 16MB or 1GB, or 0.");
      next.bufferUsageLimit = text.replace(" ", "");
    } else {
      const text = String(value ?? "");
      const list = known ? valuesOf(/** @type {keyof Options} */ (key), known) : [text];
      if (!list.includes(text))
        throw new Error(
          key === "using"
            ? `${text} is not an index CLUSTER can order this table by.`
            : `No tablespace is named ${text}.`,
        );
      Object.assign(next, { [key]: text });
    }
  }
  return next;
}

/** CLUSTER's index when none is picked: the one clustered before, else the primary key's. */
export function usingOf(/** @type {Index[]} */ indexes, /** @type {string} */ picked) {
  const can = indexes.filter(clusterable);
  if (picked && can.some((i) => i.name === picked)) return picked;
  return (can.find((i) => i.clustered) ?? can.find((i) => i.primary))?.name ?? "";
}
