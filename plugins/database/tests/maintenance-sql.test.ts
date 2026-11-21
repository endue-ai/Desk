// The maintenance form's statements, options and words (ui/features/maintenance/): VACUUM, ANALYZE,
// REINDEX and CLUSTER for each target in the syntax of PostgreSQL 13, 14, 16 and 18, the options
// each version has and what one option rules out, and what each statement locks and for how long.
import { describe, expect, it } from "vitest";
import { locksOf } from "../ui/features/maintenance/locks.js";
import type { Read } from "../ui/features/maintenance/model.js";
import {
  DEFAULTS,
  type Operation,
  type Options,
  offered,
  operationsFor,
  patched,
  type Target,
} from "../ui/features/maintenance/options.js";
import { statementOf, tooOld } from "../ui/features/maintenance/sql.js";

const MB = 1024 * 1024;
const index = (name: string, fields: Partial<Read["indexes"][number]> = {}) => ({
  ...{ name, clustered: false, primary: false, valid: true, method: "btree", partial: false },
  bytes: MB,
  ...fields,
});
const read = (version: number, patch: Partial<Read> = {}): Read => ({
  version,
  server: `${Math.floor(version / 10000)}.${version % 100}`,
  database: "warehouse",
  recovery: false,
  relkind: "r",
  table: "orders",
  tables: ["daily_totals", "orders", "stock"],
  tablespaces: ["fast", "pg_default"],
  indexes: [
    index("orders_customer_idx"),
    index("orders_note_trgm", { method: "gin", bytes: MB / 2 }),
    index("orders_pkey", { primary: true, bytes: 2.5 * MB }),
  ],
  stats: {
    ...{ live: 120000, dead: 30000, total: 16 * MB, table: 12 * MB, indexes: 4 * MB },
    ...{ lastVacuum: null, lastAutovacuum: "2026-11-20 03:12:44", lastAnalyze: null },
    ...{ lastAutoanalyze: null, tables: 1, index: null },
  },
  ...patch,
});
const TABLE: Target = { kind: "table", schema: "public", table: "orders", index: "" };
const INDEX: Target = { kind: "index", schema: "public", table: "orders", index: "orders_pkey" };
const SCHEMA: Target = { kind: "schema", schema: "public", table: "", index: "" };
const DATABASE: Target = { kind: "database", schema: "", table: "", index: "" };
const plan = (target: Target, operation: Operation, options: Partial<Options> = {}) => ({
  target,
  operation,
  options: { ...DEFAULTS, using: "orders_pkey", ...options },
});
const sql = (
  version: number,
  target: Target,
  op: Operation,
  options: Partial<Options> = {},
  patch: Partial<Read> = {},
) => statementOf(plan(target, op, options), read(version, patch));

describe("the statements", () => {
  it("writes VACUUM, ANALYZE, REINDEX and CLUSTER for a table, an index, a schema and the database on PostgreSQL 13, 14, 16 and 18", () => {
    const all = { full: true, freeze: true, analyze: true, skipLocked: true };
    const tuning = {
      indexCleanup: "off",
      truncate: "off",
      parallel: 2,
      processToast: false,
    } as const;
    // VACUUM on a table: VERBOSE by default, FULL drops what does not apply to it.
    expect(sql(130000, TABLE, "vacuum")).toEqual({
      sql: "VACUUM (VERBOSE) public.orders",
      problem: "",
    });
    expect(sql(130000, TABLE, "vacuum", { verbose: false }).sql).toBe("VACUUM public.orders");
    expect(sql(130000, TABLE, "vacuum", { ...all, ...tuning }).sql).toBe(
      "VACUUM (FULL, FREEZE, VERBOSE, ANALYZE, SKIP_LOCKED) public.orders",
    );
    // PROCESS_TOAST is 14's, BUFFER_USAGE_LIMIT 16's; INDEX_CLEANUP AUTO is 14's.
    const limit = { ...tuning, bufferUsageLimit: "256kB" };
    expect(sql(130000, TABLE, "vacuum", limit).sql).toBe(
      "VACUUM (VERBOSE, INDEX_CLEANUP OFF, TRUNCATE OFF, PARALLEL 2) public.orders",
    );
    expect(sql(140000, TABLE, "vacuum", limit).sql).toBe(
      "VACUUM (VERBOSE, INDEX_CLEANUP OFF, TRUNCATE OFF, PARALLEL 2, PROCESS_TOAST OFF) public.orders",
    );
    expect(sql(160000, TABLE, "vacuum", limit).sql).toBe(
      "VACUUM (VERBOSE, INDEX_CLEANUP OFF, TRUNCATE OFF, PARALLEL 2, PROCESS_TOAST OFF, BUFFER_USAGE_LIMIT '256kB') public.orders",
    );
    expect(sql(140000, TABLE, "vacuum", { indexCleanup: "auto", parallel: 0 }).sql).toBe(
      "VACUUM (VERBOSE, INDEX_CLEANUP AUTO, PARALLEL 0) public.orders",
    );
    expect(sql(130000, TABLE, "vacuum", { indexCleanup: "auto" }).sql).toBe(
      "VACUUM (VERBOSE) public.orders",
    );
    // ANALYZE.
    expect(sql(130000, TABLE, "analyze", { skipLocked: true, bufferUsageLimit: "1MB" }).sql).toBe(
      "ANALYZE (VERBOSE, SKIP_LOCKED) public.orders",
    );
    expect(sql(180000, TABLE, "analyze", { bufferUsageLimit: "1MB" }).sql).toBe(
      "ANALYZE (VERBOSE, BUFFER_USAGE_LIMIT '1MB') public.orders",
    );
    // REINDEX: CONCURRENTLY by default, TABLESPACE from 14.
    expect(sql(130000, TABLE, "reindex", { tablespace: "fast" }).sql).toBe(
      "REINDEX (VERBOSE) TABLE CONCURRENTLY public.orders",
    );
    expect(sql(140000, TABLE, "reindex", { tablespace: "fast" }).sql).toBe(
      "REINDEX (VERBOSE, TABLESPACE fast) TABLE CONCURRENTLY public.orders",
    );
    expect(sql(180000, TABLE, "reindex", { verbose: false, concurrently: false }).sql).toBe(
      "REINDEX TABLE public.orders",
    );
    // CLUSTER: its options in parentheses from 14 on.
    expect(sql(130000, TABLE, "cluster").sql).toBe(
      "CLUSTER VERBOSE public.orders USING orders_pkey",
    );
    expect(sql(140000, TABLE, "cluster").sql).toBe(
      "CLUSTER (VERBOSE) public.orders USING orders_pkey",
    );
    expect(sql(180000, TABLE, "cluster", { verbose: false }).sql).toBe(
      "CLUSTER public.orders USING orders_pkey",
    );
    expect(sql(170000, TABLE, "cluster", { using: "" }).problem).toBe(
      "Pick the index CLUSTER orders the table by.",
    );
    // An index: REINDEX INDEX, or CLUSTER of its table by it.
    expect(sql(170000, INDEX, "reindex").sql).toBe(
      "REINDEX (VERBOSE) INDEX CONCURRENTLY public.orders_pkey",
    );
    expect(sql(170000, INDEX, "cluster", { using: "" })).toEqual({
      sql: "CLUSTER (VERBOSE) public.orders USING orders_pkey",
      problem: "",
    });
    const gin = { ...INDEX, index: "orders_note_trgm" };
    expect(statementOf(plan(gin, "cluster"), read(170000)).problem).toMatch(
      /^CLUSTER cannot order a table by orders_note_trgm: it needs a valid, whole btree or GiST index\.$/u,
    );
    // A schema: VACUUM and ANALYZE name its tables, REINDEX SCHEMA; none to name is a problem.
    expect(sql(170000, SCHEMA, "vacuum").sql).toBe(
      "VACUUM (VERBOSE) public.daily_totals, public.orders, public.stock",
    );
    expect(sql(170000, SCHEMA, "analyze", { verbose: false }).sql).toBe(
      "ANALYZE public.daily_totals, public.orders, public.stock",
    );
    expect(sql(170000, SCHEMA, "reindex").sql).toBe("REINDEX (VERBOSE) SCHEMA CONCURRENTLY public");
    expect(sql(170000, SCHEMA, "vacuum", {}, { tables: [] }).problem).toBe(
      "Schema public holds no table to vacuum.",
    );
    // The database: every table it may.
    expect(sql(180000, DATABASE, "vacuum").sql).toBe("VACUUM (VERBOSE)");
    expect(sql(180000, DATABASE, "analyze", { verbose: false }).sql).toBe("ANALYZE");
    expect(sql(180000, DATABASE, "reindex").sql).toBe(
      "REINDEX (VERBOSE) DATABASE CONCURRENTLY warehouse",
    );
    expect(sql(130000, DATABASE, "cluster").sql).toBe("CLUSTER VERBOSE");
    expect(sql(160000, DATABASE, "cluster").sql).toBe("CLUSTER VERBOSE");
    expect(sql(170000, DATABASE, "cluster").sql).toBe("CLUSTER (VERBOSE)");
    expect(sql(140000, DATABASE, "cluster", { verbose: false }).sql).toBe("CLUSTER");
    // Names are quoted only where SQL needs it.
    const odd: Target = { kind: "table", schema: "Sales", table: "Order Items", index: "" };
    expect(statementOf(plan(odd, "vacuum"), read(170000)).sql).toBe(
      'VACUUM (VERBOSE) "Sales"."Order Items"',
    );
    const word: Target = { kind: "table", schema: "order", table: "user", index: "" };
    expect(statementOf(plan(word, "analyze"), read(170000)).sql).toBe(
      'ANALYZE (VERBOSE) "order"."user"',
    );
    const schema: Target = { kind: "schema", schema: "Sales", table: "", index: "" };
    expect(statementOf(plan(schema, "reindex"), read(170000)).sql).toBe(
      'REINDEX (VERBOSE) SCHEMA CONCURRENTLY "Sales"',
    );
  });

  it("offers only what the version and the other options allow", () => {
    const keys = (version: number, op: Operation, target = TABLE, o: Partial<Options> = {}) =>
      offered(op, target, read(version), { ...DEFAULTS, ...o }).map((x) => x.key);
    const vacuum = "full freeze verbose analyze skipLocked indexCleanup truncate parallel".split(
      " ",
    );
    expect(keys(130000, "vacuum")).toEqual(vacuum);
    expect(keys(140000, "vacuum")).toEqual([...vacuum, "processToast"]);
    expect(keys(160000, "vacuum")).toEqual([...vacuum, "processToast", "bufferUsageLimit"]);
    expect(keys(130000, "analyze")).toEqual(["verbose", "skipLocked"]);
    expect(keys(160000, "analyze")).toEqual(["verbose", "skipLocked", "bufferUsageLimit"]);
    expect(keys(130000, "reindex")).toEqual(["concurrently", "verbose"]);
    expect(keys(140000, "reindex")).toEqual(["concurrently", "verbose", "tablespace"]);
    expect(keys(130000, "cluster")).toEqual(["verbose", "using"]);
    const values = (version: number, op: Operation, key: string) =>
      offered(op, TABLE, read(version), DEFAULTS).find((x) => x.key === key)?.values;
    expect(values(130000, "vacuum", "indexCleanup")).toEqual(["", "on", "off"]);
    expect(values(140000, "vacuum", "indexCleanup")).toEqual(["", "auto", "on", "off"]);
    expect(values(140000, "reindex", "tablespace")).toEqual(["", "fast", "pg_default"]);
    // CLUSTER's indexes: the GIN one cannot order a table.
    expect(values(170000, "cluster", "using")).toEqual(["", "orders_customer_idx", "orders_pkey"]);
    // FULL rules out what it has nothing to do with.
    const full = offered("vacuum", TABLE, read(160000), { ...DEFAULTS, full: true });
    const why = Object.fromEntries(full.map((x) => [x.key, x.why]));
    for (const key of ["indexCleanup", "truncate", "parallel", "bufferUsageLimit"])
      expect(why[key], key).toBe("Not with FULL, which writes the table anew.");
    expect(why.processToast).toBe("FULL always processes the TOAST table.");
    expect(why.freeze).toBe("");
    // The operations a target takes.
    expect(operationsFor("table")).toEqual(["vacuum", "analyze", "reindex", "cluster"]);
    expect(operationsFor("index")).toEqual(["reindex", "cluster"]);
    expect(operationsFor("schema")).toEqual(["vacuum", "analyze", "reindex"]);
    expect(operationsFor("database")).toEqual(["vacuum", "analyze", "reindex", "cluster"]);
    // System catalogs are never reindexed concurrently.
    const catalog: Target = { kind: "schema", schema: "pg_catalog", table: "", index: "" };
    const offers = offered("reindex", catalog, read(170000), DEFAULTS);
    expect(offers.find((x) => x.key === "concurrently")?.why).toBe(
      "System catalogs cannot be reindexed concurrently.",
    );
    expect(statementOf(plan(catalog, "reindex"), read(170000)).sql).toBe(
      "REINDEX (VERBOSE) SCHEMA pg_catalog",
    );
    // A partitioned table is clustered from 15 on; a server older than 13 is refused.
    expect(sql(140000, TABLE, "cluster", {}, { relkind: "p" }).problem).toBe(
      "CLUSTER of a partitioned table needs PostgreSQL 15 or later.",
    );
    expect(sql(150000, TABLE, "cluster", {}, { relkind: "p" }).problem).toBe("");
    expect(tooOld("old", 120022, "12.22")).toBe(
      "old runs PostgreSQL 12.22: maintenance from this form needs PostgreSQL 13 or later.",
    );
    expect(tooOld("new", 130000, "13.0")).toBe("");
    // What a caller sends is checked.
    const bad = (patch: Record<string, unknown>) => () => patched(DEFAULTS, patch, read(170000));
    expect(bad({ parallel: 2000 })).toThrow(/PARALLEL takes 0 to 1024 workers/u);
    expect(bad({ bufferUsageLimit: "lots" })).toThrow(/BUFFER_USAGE_LIMIT is a size/u);
    expect(bad({ indexCleanup: "maybe" })).toThrow(/INDEX_CLEANUP is auto, on or off/u);
    expect(bad({ full: "yes" })).toThrow("FULL is on or off (true or false).");
    expect(bad({ loud: true })).toThrow("No option is named loud.");
    expect(bad({ using: "orders_note_trgm" })).toThrow(
      "orders_note_trgm is not an index CLUSTER can order this table by.",
    );
    expect(bad({ tablespace: "slow" })).toThrow("No tablespace is named slow.");
    expect(patched(DEFAULTS, { parallel: "4", bufferUsageLimit: "16 MB" }, null)).toMatchObject({
      parallel: 4,
      bufferUsageLimit: "16MB",
    });
  });
});

describe("what it locks", () => {
  const words = (target: Target, op: Operation, o: Partial<Options> = {}, timeout = 0) =>
    locksOf(plan(target, op, o), read(170000), timeout);

  it("says what each operation locks and for how long", () => {
    const vacuum = words(TABLE, "vacuum");
    expect(vacuum.heavy).toBe(false);
    expect(vacuum.lines[0]).toBe(
      "Reads and writes of public.orders go on: VACUUM takes SHARE UPDATE EXCLUSIVE, so only ALTER TABLE, CREATE INDEX and another VACUUM or ANALYZE of it wait.",
    );
    expect(vacuum.lines[1]).toMatch(
      /may take ACCESS EXCLUSIVE for a moment .* TRUNCATE OFF skips that\.$/u,
    );
    expect(words(TABLE, "vacuum", { truncate: "off" }).lines[1]).toBe(
      "TRUNCATE OFF: it never takes ACCESS EXCLUSIVE to give empty pages back.",
    );
    expect(vacuum.lines).toContain(
      "How long depends on the size: 16 MB in all (table 12 MB, indexes 4 MB) · 120,000 rows, 30,000 dead.",
    );
    expect(vacuum.lines.at(-1)).toBe(
      "The plugin sends it alone, outside a transaction block: VACUUM, REINDEX CONCURRENTLY, REINDEX of a schema or a database and CLUSTER of a database or a partitioned table cannot run inside one.",
    );
    const full = words(TABLE, "vacuum", { full: true, skipLocked: true });
    expect(full.heavy).toBe(true);
    expect(full.lines.slice(0, 3)).toEqual([
      "Every read and write of public.orders waits until it is written anew: VACUUM FULL takes ACCESS EXCLUSIVE and writes the table and its indexes anew.",
      "It needs free disk for the new copy, up to 16 MB more, until it ends.",
      "While it waits for its lock, sessions that come after it wait too.",
    ]);
    expect(full.lines).toContain(
      "SKIP_LOCKED: a table another session holds a conflicting lock on is skipped, not waited for.",
    );
    expect(words(TABLE, "vacuum", { analyze: true }).lines).toContain(
      "ANALYZE: then it reads a sample of the rows for the planner's statistics, under the same lock.",
    );
    expect(words(SCHEMA, "vacuum", { full: true }).lines[0]).toContain(
      "Every read and write of each table of schema public waits until it is written anew: VACUUM FULL takes ACCESS EXCLUSIVE, one table at a time",
    );
    const analyze = words(TABLE, "analyze");
    expect(analyze.heavy).toBe(false);
    expect(analyze.lines[0]).toContain(
      "ANALYZE takes SHARE UPDATE EXCLUSIVE and reads a sample of the rows",
    );
    const blocking = words(TABLE, "reindex", { concurrently: false });
    expect(blocking.heavy).toBe(true);
    expect(blocking.lines[0]).toMatch(
      /^Writes to public\.orders wait .*nearly every read waits too\.$/u,
    );
    const concurrent = words(TABLE, "reindex", { tablespace: "fast" });
    expect(concurrent.heavy).toBe(false);
    expect(concurrent.lines[0]).toMatch(
      /^Reads and writes of public\.orders go on: REINDEX CONCURRENTLY .*a second copy \(4 MB\)\.$/u,
    );
    expect(concurrent.lines[1]).toContain("_ccnew");
    expect(concurrent.lines).toContain("TABLESPACE: the indexes built anew go to fast.");
    const cluster = words(TABLE, "cluster");
    expect(cluster.heavy).toBe(true);
    expect(cluster.lines[0]).toBe(
      "Every read and write of public.orders waits until it ends: CLUSTER takes ACCESS EXCLUSIVE and writes the table anew in the order of orders_pkey, then builds its indexes.",
    );
    expect(words(DATABASE, "cluster").lines[0]).toMatch(/^Each table clustered before/u);
    expect(words(DATABASE, "reindex").lines).toContain(
      "System catalogs are skipped: they cannot be reindexed concurrently.",
    );
    expect(words(TABLE, "vacuum", {}, 30).lines.at(-1)).toBe(
      "The statement timeout in the settings (30 s) ends it if it runs longer.",
    );
  });
});
