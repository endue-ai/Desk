// The value search's SQL (ui/features/search/): which columns can hold a value on each engine, the
// condition each match writes (PostgreSQL's operators, a jsonpath over JSON values, MySQL's and
// SQLite's own functions), every name and literal quoted, a table's read-only run with its own
// statement timeout, what EXPLAIN says of the scan, and why a table failed.
import { describe, expect, it } from "vitest";
import { familyOf, holds, searchedColumns } from "../ui/features/search/columns.js";
import { defaults, optionsOf } from "../ui/features/search/model.js";
import { estimateOf, estimateText, tableTest } from "../ui/features/search/plan.js";
import {
  conditionOf,
  keyOf,
  preflight,
  rowFilter,
  scanOf,
  selectOf,
  tableRun,
  whyOf,
} from "../ui/features/search/sql.js";
import { jsonPath } from "../ui/features/search/sql-postgres.js";

type Family = "text" | "number" | "uuid" | "json" | "date";
const col = (name: string, family: Family, whole = false, type = "text") => ({
  name,
  type,
  family,
  whole,
});
const how = (
  value: string,
  match: "equals" | "contains" | "starts" | "regex",
  ignoreCase = false,
) => ({
  value,
  match,
  ignoreCase,
});
const ALL: Family[] = ["text", "number", "uuid", "json", "date"];

describe("which columns are searched", () => {
  it("picks the columns whose type can hold the value", () => {
    expect(familyOf("postgresql", "character varying(120)")).toEqual({
      family: "text",
      whole: false,
    });
    expect(familyOf("postgresql", "integer")).toEqual({ family: "number", whole: true });
    expect(familyOf("postgresql", "numeric(10,2)")).toEqual({ family: "number", whole: false });
    expect(familyOf("postgresql", "uuid")?.family).toBe("uuid");
    expect(familyOf("postgresql", "jsonb")?.family).toBe("json");
    expect(familyOf("postgresql", "timestamp(3) with time zone")?.family).toBe("date");
    expect(familyOf("postgresql", "public.citext")?.family).toBe("text");
    for (const never of ["boolean", "bytea", "text[]", "integer[]", "mood", "inet"])
      expect(familyOf("postgresql", never), never).toBeUndefined();
    expect(familyOf("mysql", "enum('a','b')")?.family).toBe("text");
    expect(familyOf("mysql", "int unsigned")).toEqual({ family: "number", whole: true });
    expect(familyOf("mysql", "json")?.family).toBe("json");
    expect(familyOf("mysql", "datetime(6)")?.family).toBe("date");
    expect(familyOf("mysql", "blob")).toBeUndefined();
    expect(familyOf("sqlite", "")?.family).toBe("text");
    expect(familyOf("sqlite", "INTEGER")?.family).toBe("number");
    expect(familyOf("sqlite", "JSON")?.family).toBe("json");
    expect(familyOf("sqlite", "BLOB")).toBeUndefined();

    const columns = [
      { name: "id", type: "integer" },
      { name: "price", type: "numeric(10,2)" },
      { name: "ref", type: "uuid" },
      { name: "doc", type: "jsonb" },
      { name: "at", type: "date" },
      { name: "on", type: "boolean" },
      { name: "note", type: "text" },
    ];
    const names = (
      value: string,
      match: "equals" | "contains" | "starts" | "regex",
      families = ALL,
    ) => searchedColumns("postgresql", columns, { value, match, families }).map((c) => c.name);
    // A number is never looked for in a uuid; a boolean never at all.
    expect(names("4242", "equals")).toEqual(["id", "price", "doc", "at", "note"]);
    expect(names("4242", "contains")).toEqual(["id", "price", "doc", "at", "note"]);
    // An integer column equals only a whole number.
    expect(names("42.5", "equals")).toEqual(["price", "doc", "at", "note"]);
    expect(names("7c9e6679-7425-40de-944b-e07fc1f90ae7", "equals")).toEqual(["ref", "doc", "note"]);
    expect(names("7c9e", "contains")).toEqual(["ref", "doc", "note"]);
    expect(names("ada", "equals")).toEqual(["doc", "note"]);
    expect(names("^a", "regex")).toEqual(["id", "price", "ref", "doc", "at", "note"]);
    expect(names("4242", "equals", ["text", "json"])).toEqual(["doc", "note"]);
    expect(holds({ family: "date", whole: false }, "contains", "Nov")).toBe(false);
  });
});

describe("PostgreSQL's conditions", () => {
  it("writes PostgreSQL's conditions for each match", () => {
    const note = col("note", "text");
    const c = (h: ReturnType<typeof how>, column = note) =>
      conditionOf("postgresql", column, h, 170006);
    expect(c(how("Ada", "equals"))).toBe(`"note" = 'Ada'`);
    expect(c(how("Ada", "equals", true))).toBe(`lower("note") = lower('Ada')`);
    expect(c(how("50%_off", "contains"))).toBe(`"note" LIKE E'%50\\\\%\\\\_off%'`);
    expect(c(how("o'k", "starts", true))).toBe(`"note" ILIKE 'o''k%'`);
    expect(c(how("^ord(er)?-\\d+$", "regex"))).toBe(`"note" ~ E'^ord(er)?-\\\\d+$'`);
    expect(c(how("ada", "regex", true))).toBe(`"note" ~* 'ada'`);
    // A number as a number, a uuid as a uuid, the rest on its text.
    expect(c(how("4242", "equals"), col("id", "number", true, "integer"))).toBe(`"id" = 4242`);
    expect(c(how("42", "contains"), col("id", "number", true, "integer"))).toBe(
      `"id"::text LIKE '%42%'`,
    );
    expect(c(how("7C9E6679-7425-40DE-944B-E07FC1F90AE7", "equals"), col("ref", "uuid"))).toBe(
      `"ref" = '7c9e6679-7425-40de-944b-e07fc1f90ae7'::uuid`,
    );
    expect(c(how("2026-11", "starts"), col("at", "date"))).toBe(`"at"::text LIKE '2026-11%'`);
    // A name with a quote in it stays one name.
    expect(c(how("x", "equals"), col('we"ird', "text"))).toBe(`"we""ird" = 'x'`);
  });

  it("matches JSON's strings and numbers at any depth, never its keys", () => {
    const doc = col("doc", "json");
    expect(jsonPath(how("4242", "equals"))).toBe('$.** ? (@ == "4242" || @ == 4242)');
    expect(jsonPath(how('say "hi"', "equals"))).toBe('$.** ? (@ == "say \\"hi\\"")');
    const pg = (h: ReturnType<typeof how>, version = 170006) =>
      conditionOf("postgresql", doc, h, version);
    expect(pg(how("4242", "equals"))).toBe(
      `jsonb_path_exists("doc"::jsonb, '$.** ? (@ == "4242" || @ == 4242)')`,
    );
    const values = (test: string) =>
      `EXISTS (SELECT 1 FROM jsonb_path_query("doc"::jsonb, 'strict $.**') AS j(v) ` +
      `WHERE jsonb_typeof(j.v) IN ('string', 'number') AND ${test})`;
    expect(pg(how("42", "contains"))).toBe(values(`(j.v #>> '{}') LIKE '%42%'`));
    expect(pg(how("Ada", "equals", true))).toBe(values(`lower((j.v #>> '{}')) = lower('Ada')`));
    expect(pg(how("ref", "starts"))).toBe(values(`(j.v #>> '{}') LIKE 'ref%'`));
    expect(pg(how("^r.f$", "regex", true))).toBe(values(`(j.v #>> '{}') ~* '^r.f$'`));
    // Before PostgreSQL 12 there is no jsonpath: the document's text.
    expect(pg(how("4242", "contains"), 110000)).toBe(`"doc"::text LIKE '%4242%'`);
  });

  it("a table's run is read-only with its own statement timeout", () => {
    const target = { schema: "public", name: "orders", from: '"public"."orders"' };
    const columns = [col("id", "number", true, "integer"), col("note", "text")];
    const key = keyOf("postgresql", ["id"], false);
    const server = { version: 170006, flavor: "" as const };
    const select = selectOf("postgresql", target, columns, key, {
      how: how("4242", "equals"),
      limit: 100,
      server,
    });
    expect(select.sql).toBe(
      `SELECT "id", CASE WHEN "id" = 4242 THEN '=' || left("id"::text, 120) END, ` +
        `CASE WHEN "note" = '4242' THEN '=' || left("note"::text, 120) END FROM "public"."orders" ` +
        `WHERE ("id" = 4242) OR ("note" = '4242') LIMIT 101`,
    );
    expect(tableRun("postgresql", select.sql, { timeoutMs: 10_000, server }).statements).toEqual([
      "BEGIN READ ONLY",
      "SET LOCAL statement_timeout = 10000",
      `EXPLAIN ${select.sql}`,
      select.sql,
      "COMMIT",
    ]);
    // Without a primary key a row is named by its ctid (and its partition's oid).
    const byCtid = selectOf(
      "postgresql",
      target,
      [columns[1] as never],
      keyOf("postgresql", [], true),
      {
        how: how("x", "equals"),
        limit: 5,
        server,
      },
    );
    expect(byCtid.sql).toMatch(/^SELECT ctid::text, tableoid::regclass::text, CASE WHEN/u);
    expect(rowFilter("postgresql", keyOf("postgresql", [], true), ["(0,5)", "public.p1"], "")).toBe(
      "ctid = '(0,5)'::tid AND tableoid = 'public.p1'::regclass",
    );
    expect(rowFilter("postgresql", keyOf("postgresql", ["id", "k"], false), ["1", "o'k"], "")).toBe(
      `"id" = '1' AND "k" = 'o''k'`,
    );
    expect(preflight("postgresql", how("a(b", "regex", true))).toEqual([
      "SELECT current_setting('server_version_num')",
      "SELECT '' ~* 'a(b'",
    ]);
  });

  it("reads the scan from EXPLAIN and a failure's reason from its words", () => {
    const plan = (...lines: string[]) => ({ columns: ["QUERY PLAN"], rows: lines.map((l) => [l]) });
    expect(scanOf("postgresql", plan("Limit", "  ->  Seq Scan on orders"))).toBe("full");
    expect(
      scanOf(
        "postgresql",
        plan(
          "Limit",
          "  ->  Bitmap Heap Scan on orders",
          "    ->  BitmapOr",
          "      ->  Bitmap Index Scan on orders_pkey",
        ),
      ),
    ).toBe("index");
    expect(
      scanOf("postgresql", plan("Limit", "  ->  Index Scan using orders_pkey on orders")),
    ).toBe("index");
    expect(
      scanOf("sqlite", {
        columns: ["id", "parent", "notused", "detail"],
        rows: [["2", "0", "0", "SCAN t"]],
      }),
    ).toBe("full");
    expect(
      scanOf("sqlite", {
        columns: ["id", "parent", "notused", "detail"],
        rows: [["2", "0", "0", "SEARCH t USING INDEX t_name (name=?)"]],
      }),
    ).toBe("index");
    expect(
      scanOf("mysql", {
        columns: ["id", "select_type", "table", "type"],
        rows: [["1", "SIMPLE", "t", "ALL"]],
      }),
    ).toBe("full");
    expect(
      whyOf({ kind: "sql", message: "canceling statement due to statement timeout" }).why,
    ).toBe("timeout");
    expect(
      whyOf({ kind: "sql", code: "42501", message: "permission denied for table secrets" }).why,
    ).toBe("permission");
    expect(
      whyOf({ kind: "sql", message: "SELECT command denied to user 'app'@'%' for table 'x'" }).why,
    ).toBe("permission");
    expect(
      whyOf({
        kind: "sql",
        message: "Query execution was interrupted, maximum statement execution time exceeded",
      }).why,
    ).toBe("timeout");
    expect(whyOf({ kind: "sql", message: "relation does not exist" }).why).toBe("failed");
  });
});

describe("the other engines", () => {
  it("MySQL and SQLite search with their own functions", () => {
    const note = col("note", "text");
    const my = (h: ReturnType<typeof how>, column = note) => conditionOf("mysql", column, h, 0);
    expect(my(how("Ada", "equals"))).toBe("CAST(`note` AS BINARY) = CAST('Ada' AS BINARY)");
    expect(my(how("Ada", "contains", true))).toBe("LOCATE(LOWER('Ada'), LOWER(`note`)) > 0");
    expect(my(how("Ad", "starts"))).toBe("CAST(LEFT(`note`, 2) AS BINARY) = CAST('Ad' AS BINARY)");
    expect(my(how("^a\\d", "regex", true))).toBe("`note` REGEXP '(?i)^a\\\\d'");
    expect(my(how("^a", "regex"))).toBe("`note` REGEXP '(?-i)^a'");
    expect(my(how("42", "contains"), col("doc", "json"))).toBe(
      "JSON_SEARCH(`doc`, 'one', '%42%') IS NOT NULL",
    );
    expect(my(how("4242", "equals"), col("n", "number", true))).toBe("`n` = 4242");
    const server = { version: 0, flavor: "mariadb" as const };
    expect(
      tableRun("mysql", "SELECT 1", { timeoutMs: 10_000, server }).statements.slice(0, 2),
    ).toEqual(["SET SESSION max_statement_time = 10", "START TRANSACTION READ ONLY"]);
    expect(
      tableRun("mysql", "SELECT 1", { timeoutMs: 2500, server: { version: 0, flavor: "mysql" } })
        .statements[0],
    ).toBe("SET SESSION max_execution_time = 2500");

    const lite = (h: ReturnType<typeof how>, column = note) => conditionOf("sqlite", column, h, 0);
    expect(lite(how("Ada", "equals"))).toBe(`"note" = 'Ada'`);
    expect(lite(how("Ada", "contains", true))).toBe(
      `instr(lower(CAST("note" AS TEXT)), lower('Ada')) > 0`,
    );
    expect(lite(how("^a", "regex"))).toBe(`CAST("note" AS TEXT) REGEXP '^a'`);
    expect(lite(how("^a", "regex", true))).toBe(`regexpi('^a', CAST("note" AS TEXT))`);
    expect(lite(how("42", "contains"), col("doc", "json"))).toBe(
      `CASE WHEN json_valid("doc") THEN EXISTS (SELECT 1 FROM json_tree("doc") j WHERE j.type IN ('text', 'integer', 'real') AND instr(CAST(j.atom AS TEXT), '42') > 0) ELSE 0 END`,
    );
    expect(
      tableRun("sqlite", "SELECT 1", { timeoutMs: 1000, server: { version: 0, flavor: "" } })
        .statements,
    ).toEqual(["PRAGMA query_only = 1", "EXPLAIN QUERY PLAN SELECT 1", "SELECT 1"]);
    expect(keyOf("sqlite", [], false).by).toBe("rowid");
    expect(keyOf("mysql", [], false).by).toBe("match");
    expect(rowFilter("mysql", keyOf("mysql", [], false), [], "`note` = 'x'")).toBe("`note` = 'x'");
  });
});

describe("the options and the estimate", () => {
  it("holds every number to its limits, an agent's too", () => {
    const o = optionsOf(
      {
        value: "4242",
        rowLimit: 5000,
        timeoutSeconds: 0,
        sizeLimit: -3,
        types: ["json", "bogus"],
        match: "nope",
        tables: ["orders", "sales.*"],
      },
      defaults(),
    );
    expect(o).toMatchObject({
      value: "4242",
      rowLimit: 1000,
      timeoutSeconds: 1,
      sizeLimit: 1,
      families: ["json"],
      match: "equals",
      tables: "orders, sales.*",
    });
    const test = tableTest("orders, sales.audit_*");
    expect([
      test("public", "orders"),
      test("sales", "audit_2026"),
      test("public", "audit_2026"),
    ]).toEqual([true, true, false]);
  });

  it("says what it reads and what it leaves out past the size limit", () => {
    const options = { ...defaults(), sizeLimit: 1_000_000 };
    const t = (name: string, rows: number | null) => ({
      schema: "public",
      name,
      kind: "table",
      rows,
      partitioned: false,
    });
    const e = estimateOf([t("a", 950), t("b", null), t("log", 5_000_000)], options);
    expect(e.search.map((c) => c.name)).toEqual(["a", "b"]);
    expect(estimateText(e, options)).toBe(
      "Reads 2 tables, about 950 rows and 1 of unknown size, one at a time, read-only, at most 10 s each. Left out, over 1,000,000 rows: public.log (about 5 million).",
    );
    expect(estimateOf([t("log", 5_000_000)], { ...options, big: true }).search).toHaveLength(1);
  });
});
