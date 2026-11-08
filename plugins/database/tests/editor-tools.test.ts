// The editor's tools: Format SQL (only space and the case of reserved words change) and parameters
// (`:name`, `?`, `$1`) filled from a prompt as literals.
import { describe, expect, it } from "vitest";
import { formatSql } from "../ui/editor/format.js";
import { asked, fill, paramsOf, valueSql } from "../ui/editor/params.js";
import { tokenize } from "../ui/sql/lexer.js";

type Dialect = "postgresql" | "mysql" | "sqlite";
/** The tokens that are not space, words in capitals: what formatting must keep. */
const meaning = (sql: string, dialect: Dialect) =>
  tokenize(sql, dialect)
    .filter((t) => t.type !== "space")
    .map((t) => (t.type === "word" ? t.text.toUpperCase() : t.text));

describe("format", () => {
  it("puts clauses on lines, the select list one a line, AND and OR under WHERE", () => {
    const sql =
      "select a, b.c, count(*) from t join u b on b.id = t.id and b.x > 1 where t.k between 1 and 2 and (x or y) or z group by a order by 1 limit 5";
    expect(formatSql(sql, "postgresql")).toBe(
      [
        "SELECT a,",
        "       b.c,",
        "       count(*)",
        "FROM t",
        "JOIN u b ON b.id = t.id",
        "  AND b.x > 1",
        "WHERE t.k BETWEEN 1 AND 2",
        "  AND (x OR y)",
        "  OR z",
        "GROUP BY a",
        "ORDER BY 1",
        "LIMIT 5",
      ].join("\n"),
    );
  });

  it("indents subqueries, writes CREATE TABLE a column a line and keeps statements apart", () => {
    const sql =
      "create table t (id int primary key, n numeric(10, 2) not null);insert into t (id) select id from (select id from u where id > 0) s;update t set a = 1, b = 'x' where id = 2";
    expect(formatSql(sql, "sqlite")).toBe(
      [
        "CREATE TABLE t (",
        "  id INT PRIMARY KEY,",
        "  n NUMERIC(10, 2) NOT NULL",
        ");",
        "",
        "INSERT INTO t (id)",
        "SELECT id",
        "FROM (",
        "  SELECT id",
        "  FROM u",
        "  WHERE id > 0",
        ") s;",
        "",
        "UPDATE t",
        "SET a = 1,",
        "    b = 'x'",
        "WHERE id = 2",
      ].join("\n"),
    );
  });

  it("never changes strings, names, comments, casts or operators", () => {
    const cases: [string, Dialect][] = [
      [
        "select 'from  where', \"Select\", x::int, a<=b, $1, $$ select  1 $$ -- from x\nfrom t",
        "postgresql",
      ],
      ["select `from`, @@session.sql_mode, 'a\\'b' # where\nfrom user where full = 1", "mysql"],
      ["DELIMITER //\ncreate procedure p() begin select 1; end//\nDELIMITER ;\nselect 2", "mysql"],
      ["select [order], x from t where y glob 'a*' /* keep */ and z is not null", "sqlite"],
    ];
    for (const [sql, dialect] of cases) {
      const formatted = formatSql(sql, dialect);
      expect(meaning(formatted, dialect), formatted).toEqual(meaning(sql, dialect));
      expect(formatSql(formatted, dialect)).toBe(formatted);
    }
    expect(formatSql("select 1 -- note\nfrom t", "postgresql")).toBe("SELECT 1 -- note\nFROM t");
    expect(formatSql("select full from user", "mysql")).toBe("SELECT full\nFROM user");
  });
});

describe("parameters", () => {
  it("finds :name, ? and $1 where each dialect has them, never in strings or casts", () => {
    const pg = "select :id, $1, x::int, ':no', data ? 'key' from t where a = :id";
    expect(paramsOf(pg, "postgresql").map((p) => p.key)).toEqual([":id", "$1", ":id"]);
    expect(asked(paramsOf(pg, "postgresql")).map((p) => p.label)).toEqual([":id", "$1"]);
    const my = "select * from t where a = ? and b = ? and c = :c -- ?";
    expect(paramsOf(my, "mysql").map((p) => p.label)).toEqual(["parameter 1", "parameter 2", ":c"]);
  });

  it("fills them with literals: numbers, NULL, quoted strings, or an expression after =", () => {
    expect(valueSql("postgresql", "42")).toBe("42");
    expect(valueSql("postgresql", "null")).toBe("NULL");
    expect(valueSql("postgresql", "it's")).toBe("'it''s'");
    expect(valueSql("mysql", "a\\b")).toBe("'a\\\\b'");
    expect(valueSql("sqlite", "=date('now')")).toBe("date('now')");
    const sql = "select * from t where a = :a and b = ? and c = :a";
    const params = paramsOf(sql, "sqlite");
    expect(fill(sql, params, { ":a": "1", "?1": "'x'" })).toBe(
      "select * from t where a = 1 and b = 'x' and c = 1",
    );
    expect(() => fill(sql, params, { ":a": "1" })).toThrow(/parameter 1/u);
  });
});
