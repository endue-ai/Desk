// The statement under the caret, the selection's statements and a whole script, cut the way each
// client cuts them: dollar quotes, comments, DELIMITER, and the BEGIN ... END bodies that keep their
// own semicolons (MySQL's without a DELIMITER too, as DataGrip reads them).
import { describe, expect, it } from "vitest";
import { split, statementAt } from "../ui/sql/split.js";

type Dialect = "postgresql" | "mysql" | "sqlite";
const texts = (sql: string, dialect: Dialect) => split(sql, dialect).map((s) => s.text);
/** The statement at the `|` of `sql`. */
const under = (sql: string, dialect: Dialect) => {
  const caret = sql.indexOf("|");
  const text = sql.replace("|", "");
  return statementAt(split(text, dialect), caret, text)?.text;
};

describe("the statement at the caret", () => {
  it("is the one the caret is in, else the one ending on its line, else the next", () => {
    const sql = "select 1;\n\nselect 2; |\n\nselect 3;";
    expect(under(sql, "postgresql")).toBe("select 2");
    expect(under("sel|ect 1; select 2", "postgresql")).toBe("select 1");
    expect(under("select 1;\n|\nselect 2", "postgresql")).toBe("select 2");
    expect(under("select $$ a; | b $$; select 2", "postgresql")).toBe("select $$ a;  b $$");
  });

  it("keeps PostgreSQL's dollar quotes, nested comments and function bodies whole", () => {
    const sql = [
      "create function f() returns int as $body$ begin return 1; end; $body$ language plpgsql;",
      "do $$ begin perform 1; end $$;",
      "/* a; /* b; */ c; */ select 'x;y' -- z;",
      ";",
    ].join("\n");
    expect(texts(sql, "postgresql")).toEqual([
      "create function f() returns int as $body$ begin return 1; end; $body$ language plpgsql",
      "do $$ begin perform 1; end $$",
      "/* a; /* b; */ c; */ select 'x;y' -- z;",
    ]);
  });

  it("follows MySQL's DELIMITER, and keeps a routine's BEGIN ... END whole without one", () => {
    const delimited =
      "DELIMITER //\ncreate procedure p() begin select 1; end//\nDELIMITER ;\ncall p();";
    expect(texts(delimited, "mysql")).toEqual([
      "create procedure p() begin select 1; end",
      "call p()",
    ]);
    const bare = [
      "create definer = current_user procedure p(in n int)",
      "begin",
      "  declare i int default 0;",
      "  while i < n do set i = i + 1; end while;",
      "  if i > 1 then select 'big'; else select case when i = 1 then 'one' end; end if;",
      "  lbl: loop leave lbl; end loop lbl;",
      "  case i when 0 then select 0; else begin end; end case;",
      "end;",
      "select 2;",
      "create trigger t before insert on x for each row set new.a = 1;",
      "begin;",
      "select 3",
    ].join("\n");
    const statements = texts(bare, "mysql");
    expect(statements).toHaveLength(5);
    expect(statements[0]).toMatch(/^create definer[\s\S]*end case;\nend$/u);
    expect(statements.slice(1)).toEqual([
      "select 2",
      "create trigger t before insert on x for each row set new.a = 1",
      "begin",
      "select 3",
    ]);
    expect(texts("begin not atomic select 1; select 2; end;\nselect 3", "mysql")).toEqual([
      "begin not atomic select 1; select 2; end",
      "select 3",
    ]);
  });

  it("reads MySQL's # and -- comments and backslash escapes", () => {
    expect(texts("select 'a\\';b'; # c;\nselect 2 --x;\n-- d;\n;", "mysql")).toEqual([
      "select 'a\\';b'",
      "# c;\nselect 2 --x",
    ]);
  });

  it("keeps SQLite's trigger bodies and bracketed names whole", () => {
    const sql =
      "create trigger t after insert on [a;b] begin update x set n = n + 1; select case when 1 then 2 end; end; select 1";
    expect(texts(sql, "sqlite")).toEqual([
      "create trigger t after insert on [a;b] begin update x set n = n + 1; select case when 1 then 2 end; end",
      "select 1",
    ]);
  });

  it("knows where each statement starts, for the client's error position", () => {
    const [, second] = split("select 1;\n  select\n 2", "postgresql");
    expect(second).toMatchObject({ start: 12, line: 2, column: 3 });
  });
});
