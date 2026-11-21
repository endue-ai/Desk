// The maintenance form's model: a target from an explorer row or a command's arguments, what the
// server's rows say of it (the version, the sizes, the statistics, the indexes), what the progress
// views say of a run, sizes in words, and the statistics before and after a run side by side. Pure.

/**
 * @typedef {import("./options.js").Target} Target
 * @typedef {import("./options.js").Index} Index
 * @typedef {import("./sql.js").Facts} Facts
 * @typedef {{
 *   live: number | null, dead: number | null, total: number | null, table: number | null,
 *   indexes: number | null, lastVacuum: string | null, lastAutovacuum: string | null,
 *   lastAnalyze: string | null, lastAutoanalyze: string | null, tables: number, index: number | null,
 * }} Stats
 *   Sizes in bytes; `index` is the size of an index target's index; the last runs as the server's
 *   local time text, null when never.
 * @typedef {Facts & { server: string, recovery: boolean, table: string, stats: Stats }} Read
 *   `table` is the table's name (an index target's table).
 * @typedef {{
 *   pid: number, wait: string, blockedBy: number[], ms: number | null, command: string,
 *   phase: string, done: number | null, total: number | null, relation: string,
 * }} Progress
 *   `wait` is "Lock: relation" while the run waits, "" while it works.
 */

const SEP = "\u0000";
const num = (/** @type {string | null | undefined} */ v) =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);
const str = (/** @type {string | null | undefined} */ v) =>
  v === null || v === undefined ? "" : v;

/** The whole database of a connection, as a target. */
export const WHOLE = /** @type {Readonly<Target>} */ ({
  kind: "database",
  schema: "",
  table: "",
  index: "",
});

/** A target from an explorer row: its connection's database, a schema, a table or an index. */
export function targetOf(/** @type {import("../../explorer.js").Node} */ node) {
  const blank = { ...WHOLE };
  const indexed = ["index", "primary key", "unique", "exclusion"];
  if (node.kind === "connection") return blank;
  if (node.kind === "group" || node.kind === "info")
    throw new Error("Pick a connection, a schema, a table or an index in the explorer.");
  const schema = node.schema ?? "";
  if (node.kind === "part" && node.part && indexed.includes(node.part.kind))
    return { ...blank, kind: "index", schema, table: node.table ?? "", index: node.part.name };
  if (node.kind === "object")
    throw new Error(`${node.label} is not a table: maintenance runs on tables and their indexes.`);
  if (node.kind === "table") {
    const kind = node.object?.kind ?? "table";
    if (kind !== "table" && kind !== "materialized view")
      throw new Error(
        `${node.label} is a ${kind}: maintenance runs on tables and materialized views.`,
      );
  }
  if (node.table) return { ...blank, kind: "table", schema, table: node.table };
  if (node.schema !== undefined) return { ...blank, kind: "schema", schema };
  return blank;
}

/** A target from a command's arguments: an index, else a table, else a schema, else the database. */
export function targetFrom(/** @type {Record<string, unknown>} */ args) {
  const s = (/** @type {unknown} */ v) => (typeof v === "string" ? v : "");
  const [schema, table, index] = [s(args.schema), s(args.table), s(args.index)];
  if ((table || index) && !schema) throw new Error("Name the schema of the table or the index.");
  if (index) return { kind: /** @type {const} */ ("index"), schema, table: "", index };
  if (table) return { kind: /** @type {const} */ ("table"), schema, table, index: "" };
  if (schema) return { kind: /** @type {const} */ ("schema"), schema, table: "", index: "" };
  return undefined;
}

/** A target in words: "public.orders", "index public.orders_pkey", "schema public". */
export function labelOf(/** @type {Target} */ t, /** @type {string} */ database) {
  if (t.kind === "index") return `index ${t.schema}.${t.index}`;
  if (t.kind === "table") return `${t.schema}.${t.table}`;
  if (t.kind === "schema") return `schema ${t.schema}`;
  return `database ${database}`;
}

/** The key of a target, for one panel per connection and target. */
export const keyOf = (/** @type {Target} */ t) => [t.kind, t.schema, t.table, t.index].join(SEP);

/** The statistics row (statsSql) and an index target's index (from the indexes' rows). */
export function statsOf(
  /** @type {(string | null)[]} */ row,
  /** @type {Index[]} */ indexes = [],
  /** @type {string} */ index = "",
) {
  return /** @type {Stats} */ ({
    live: num(row[1]),
    dead: num(row[2]),
    total: num(row[3]),
    table: num(row[4]),
    indexes: num(row[5]),
    lastVacuum: row[6] || null,
    lastAutovacuum: row[7] || null,
    lastAnalyze: row[8] || null,
    lastAutoanalyze: row[9] || null,
    tables: num(row[10]) ?? 0,
    index: index ? (indexes.find((i) => i.name === index)?.bytes ?? null) : null,
  });
}

/** The indexes' rows (indexesSql). */
export const indexesOf = (/** @type {(string | null)[][]} */ rows) =>
  rows.map(
    (r) =>
      /** @type {Index} */ ({
        name: str(r[0]),
        clustered: r[1] === "t",
        primary: r[2] === "t",
        valid: r[3] === "t",
        method: str(r[4]),
        partial: r[5] === "t",
        bytes: num(r[6]),
      }),
  );

/**
 * What the facts' read answered (factsSql's sets after the SET: head, tablespaces, statistics,
 * then the indexes or a schema's tables).
 * @param {Target} target
 * @param {(string | null)[][][]} sets
 * @returns {Read}
 */
export function readOf(target, sets) {
  const [head = [], spaces = [], stats = [], extra = []] = sets;
  const h = head[0] ?? [];
  const row = stats[0] ?? [];
  const indexes = target.kind === "table" || target.kind === "index" ? indexesOf(extra) : [];
  return {
    database: str(h[0]),
    version: num(h[1]) ?? 0,
    server: str(h[2]),
    recovery: h[3] === "t",
    tablespaces: spaces.map((r) => str(r[0])),
    relkind: str(row[0]),
    table: str(row[11]),
    indexes,
    tables: target.kind === "schema" ? extra.map((r) => str(r[0])) : [],
    stats: statsOf(row, indexes, target.kind === "index" ? target.index : ""),
  };
}

/** The first progress row (progressSql) of the run's session, or null when none is found. */
export function progressOf(/** @type {(string | null)[][]} */ rows) {
  const r = rows[0];
  if (!r) return null;
  const rel = (/** @type {string | null | undefined} */ v) => (v && v !== "-" ? v : "");
  // Each view's command, then the columns of its phase, blocks done, blocks in all and relation:
  // pg_stat_progress_cluster, _create_index, _analyze, _vacuum (one has the session at a time).
  /** @type {[string | null | undefined, number][]} */
  const views = [
    [r[9], 10],
    [r[14], 15],
    [r[19] ? "ANALYZE" : null, 19],
    [r[5] ? "VACUUM" : null, 5],
  ];
  const [command, at] = views.find(([c]) => c) ?? [null, -1];
  return /** @type {Progress} */ ({
    pid: num(r[0]) ?? 0,
    wait: r[1] === "Lock" ? `Lock: ${str(r[2])}` : "",
    blockedBy: str(r[3]).split(" ").filter(Boolean).map(Number),
    ms: num(r[4]),
    command: str(command),
    phase: at < 0 ? "" : str(r[at]),
    done: at < 0 ? null : num(r[at + 1]),
    total: at < 0 ? null : num(r[at + 2]),
    relation: at < 0 ? "" : rel(r[at + 3]),
  });
}

/** Bytes in words, in steps of 1024 as pg_size_pretty: "8 kB", "1.2 MB". */
export function sizeOf(/** @type {number | null} */ bytes) {
  if (bytes === null) return "unknown";
  const units = ["bytes", "kB", "MB", "GB", "TB", "PB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  const shown = u === 0 || n >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${shown.toLocaleString("en-US")} ${units[u]}`;
}

const count = (/** @type {number | null} */ n) =>
  n === null ? "unknown" : n.toLocaleString("en-US");

/**
 * The statistics before and after, a row each: what, before, after, whether it changed.
 * @param {Target} target
 * @param {Stats} before
 * @param {Stats} after
 */
export function compared(target, before, after) {
  /** @type {[string, (s: Stats) => string][]} */
  const rows = [
    ["Live rows", (s) => count(s.live)],
    ["Dead rows", (s) => count(s.dead)],
    ["Size in all", (s) => sizeOf(s.total)],
    ...(target.kind === "database"
      ? []
      : /** @type {[string, (s: Stats) => string][]} */ ([
          ["Table", (s) => sizeOf(s.table)],
          ["Indexes", (s) => sizeOf(s.indexes)],
        ])),
    ...(target.kind === "index"
      ? /** @type {[string, (s: Stats) => string][]} */ ([
          [`Index ${target.index}`, (s) => sizeOf(s.index)],
        ])
      : []),
    ["Last vacuum", (s) => s.lastVacuum ?? "never"],
    ["Last autovacuum", (s) => s.lastAutovacuum ?? "never"],
    ["Last analyze", (s) => s.lastAnalyze ?? "never"],
    ["Last autoanalyze", (s) => s.lastAutoanalyze ?? "never"],
  ];
  return rows.map(([label, show]) => {
    const [b, a] = [show(before), show(after)];
    return { label, before: b, after: a, changed: a !== b };
  });
}

/** The target's size and rows in one line. */
export function summaryOf(/** @type {Target} */ t, /** @type {Stats} */ s) {
  const parts =
    t.kind === "database"
      ? [`${sizeOf(s.total)} in all`]
      : [`${sizeOf(s.total)} in all (table ${sizeOf(s.table)}, indexes ${sizeOf(s.indexes)})`];
  if (t.kind === "index") parts.push(`the index ${sizeOf(s.index)}`);
  if (t.kind === "schema" || t.kind === "database")
    parts.push(`${count(s.tables)} ${s.tables === 1 ? "table" : "tables"}`);
  parts.push(`${count(s.live)} rows, ${count(s.dead)} dead`);
  return parts.join(" · ");
}
