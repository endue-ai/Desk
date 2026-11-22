import { describe, expect, it } from "vitest";
import { classify, readsOnly } from "../ui/sql/classify.js";
import { split } from "../ui/sql/split.js";

type Dialect = "postgresql" | "mysql" | "sqlite";
const one = (sql: string, dialect: Dialect = "postgresql") => {
  const [statement] = split(sql, dialect);
  if (!statement) throw new Error(`no statement in ${sql}`);
  return classify(statement, dialect);
};

describe("classify", () => {
  it("tells reads, writes, DDL, transactions and session statements apart", () => {
    expect(one("select * from t")).toMatchObject({ kind: "read", verb: "SELECT", rows: true });
    expect(one("(select 1) union (select 2)")).toMatchObject({ kind: "read", rows: true });
    expect(one("with x as (delete from t returning *) select * from x")).toMatchObject({
      kind: "write",
      verb: "DELETE",
    });
    expect(one("with x as (select 1) select * from x")).toMatchObject({ kind: "read" });
    expect(one("insert into t values (1) returning id")).toMatchObject({
      kind: "write",
      rows: true,
    });
    expect(one("update t set a = 1 where id = 2")).toMatchObject({
      kind: "write",
      rows: false,
      dangerous: "",
    });
    expect(one("select * into newtable from t")).toMatchObject({ kind: "write", rows: false });
    expect(one("create table t (a int)")).toMatchObject({ kind: "ddl" });
    expect(one("begin")).toMatchObject({ kind: "transaction" });
    expect(one("start transaction", "mysql")).toMatchObject({ kind: "transaction" });
    expect(one("set search_path = app")).toMatchObject({ kind: "session" });
    expect(one("show tables", "mysql")).toMatchObject({ kind: "read", rows: true });
    expect(one("pragma table_info(t)", "sqlite")).toMatchObject({ kind: "read", rows: true });
    expect(one("pragma journal_mode = wal", "sqlite")).toMatchObject({ kind: "session" });
    expect(one("vacuum")).toMatchObject({ kind: "ddl" });
    expect(one("frobnicate the database")).toMatchObject({ kind: "write" });
  });

  it("reads EXPLAIN as a read unless ANALYZE runs a write", () => {
    expect(one("explain select 1")).toMatchObject({ kind: "read", verb: "EXPLAIN" });
    expect(one("explain analyze select 1")).toMatchObject({ kind: "read" });
    expect(one("explain (analyze, buffers) delete from t")).toMatchObject({ kind: "write" });
    expect(one("explain analyze update t set a = 1", "mysql")).toMatchObject({ kind: "write" });
  });

  it("names what is dangerous", () => {
    expect(one("delete from t").dangerous).toBe("DELETE without WHERE changes every row.");
    expect(one("update t set a = (select b from u where u.id = 1)").dangerous).toMatch(
      /without WHERE/u,
    );
    expect(one("drop table t").dangerous).toBe("DROP TABLE removes it for good.");
    expect(one("truncate t").dangerous).toBe("TRUNCATE removes every row.");
    expect(one("alter table t drop column a").dangerous).toMatch(/ALTER/u);
    expect(one("delete from t where id = 1").dangerous).toBe("");
  });

  it("refuses what a client must not run here", () => {
    expect(one("\\! rm -rf ~").refused).toMatch(/psql meta-commands/u);
    expect(one("\\copy t from 'x'").refused).toMatch(/psql meta-commands/u);
    expect(one("copy t from stdin").refused).toMatch(/COPY/u);
    expect(one("copy t to stdout").refused).toMatch(/COPY/u);
    expect(one(".shell ls", "sqlite").refused).toMatch(/dot-commands/u);
    expect(one("\\! ls", "mysql").refused).toMatch(/client commands/u);
    expect(one("select '\\! not a command'").refused).toBe("");
  });

  it("marks statements that would make a read-only session write", () => {
    expect(one("set default_transaction_read_only = off").opensWrite).toBe(true);
    expect(one("begin read write").opensWrite).toBe(true);
    expect(one("set session transaction read write", "mysql").opensWrite).toBe(true);
    expect(one("set statement_timeout = 1000").opensWrite).toBe(false);
  });

  it("lets a read-only connection run reads, transactions and settings, nothing that writes", () => {
    const all = (sql: string) => split(sql, "postgresql").map((s) => classify(s, "postgresql"));
    expect(readsOnly(all("begin; set search_path = a; select 1; rollback"))).toBe(true);
    expect(readsOnly(all("select 1; insert into t values (1)"))).toBe(false);
    expect(readsOnly(all("set transaction_read_only = off"))).toBe(false);
  });
});
