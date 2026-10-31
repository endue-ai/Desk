import { describe, expect, it } from "vitest";
import { tokenize } from "../ui/sql/lexer.js";
import { split, statementAt } from "../ui/sql/split.js";

const texts = (sql: string, dialect: "postgresql" | "mysql" | "sqlite") =>
  split(sql, dialect).map((s) => s.text);

describe("tokenize", () => {
  it("gives the script back whole", () => {
    const sql = "select 'a;b', \"c;d\", $$e;f$$ -- g;\n/* h; /* i; */ j; */ ;";
    for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
      expect(
        tokenize(sql, dialect)
          .map((t) => t.text)
          .join(""),
      ).toBe(sql.replace(/^(.*)$/su, "$1"));
    }
  });
});

describe("split, PostgreSQL", () => {
  it("cuts at semicolons outside strings, quoted names, comments and dollar quotes", () => {
    const sql = [
      "select 'it''s; fine', E'back\\'slash;', \"odd;name\" from t; -- end; here",
      "select $$a;b$$, $fn$ c; $$ d $fn$;",
      "/* outer /* nested; */ still; */ select 3",
    ].join("\n");
    expect(texts(sql, "postgresql")).toEqual([
      "select 'it''s; fine', E'back\\'slash;', \"odd;name\" from t",
      "-- end; here\nselect $$a;b$$, $fn$ c; $$ d $fn$",
      "/* outer /* nested; */ still; */ select 3",
    ]);
  });

  it("keeps a function's BEGIN ATOMIC body whole, CASE inside it too", () => {
    const sql =
      "create or replace function f() returns int language sql begin atomic select case when true then 1 end; select 2; end; select 3;";
    expect(texts(sql, "postgresql")).toEqual([
      "create or replace function f() returns int language sql begin atomic select case when true then 1 end; select 2; end",
      "select 3",
    ]);
  });

  it("does not take a transaction's BEGIN for a body, and keeps $1 a parameter", () => {
    expect(texts("begin; select $1; commit;", "postgresql")).toEqual([
      "begin",
      "select $1",
      "commit",
    ]);
  });

  it("drops statements that are only comments and records where each starts", () => {
    const statements = split("  -- only a comment\n;\n\n  select 1;\n  select\n 2", "postgresql");
    expect(statements.map((s) => [s.text, s.line, s.column])).toEqual([
      ["select 1", 4, 3],
      ["select\n 2", 5, 3],
    ]);
  });
});

describe("split, MySQL", () => {
  it("reads backslash escapes, backticks, # and -- comments", () => {
    const sql = "select 'a\\';b', \"c;d\", `e;f` from t # x;y\n; select 1 -- z;\n;select 2--3;";
    expect(texts(sql, "mysql")).toEqual([
      "select 'a\\';b', \"c;d\", `e;f` from t # x;y",
      "select 1 -- z;",
      "select 2--3",
    ]);
  });

  it("follows DELIMITER lines, also when the delimiter ends a word", () => {
    const sql = [
      "DELIMITER //",
      "create procedure p() begin select 1; select 2; end//",
      "delimiter $$",
      "create trigger t before insert on x for each row begin set new.a = 1; end$$",
      "DELIMITER ;",
      "select 3;",
    ].join("\n");
    expect(texts(sql, "mysql")).toEqual([
      "create procedure p() begin select 1; select 2; end",
      "create trigger t before insert on x for each row begin set new.a = 1; end",
      "select 3",
    ]);
  });
});

describe("split, SQLite", () => {
  it("keeps a trigger's BEGIN ... END whole and reads [names] and `names`", () => {
    const sql =
      "create temp trigger tr after insert on [a;b] begin insert into `c;d` values (1); update x set y = case when 1 then 2 end; end; select 1;";
    expect(texts(sql, "sqlite")).toEqual([
      "create temp trigger tr after insert on [a;b] begin insert into `c;d` values (1); update x set y = case when 1 then 2 end; end",
      "select 1",
    ]);
  });
});

describe("statementAt", () => {
  const sql = "select 1;\nselect 2; \nselect 3";
  const statements = split(sql, "postgresql");

  it("finds the statement the caret is in, or the one just before it on the line", () => {
    expect(statementAt(statements, 3, sql)?.text).toBe("select 1");
    expect(statementAt(statements, sql.indexOf("; \n") + 2, sql)?.text).toBe("select 2");
    expect(statementAt(statements, sql.length, sql)?.text).toBe("select 3");
  });
});
