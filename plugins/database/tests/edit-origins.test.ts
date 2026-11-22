// A PostgreSQL result mapped by its columns' origins (PG-45, #472, ADR 0350): the session's table
// OID and column number per column, the catalog's relations read by OID, and which cells of a join,
// a table without a key and a view can change, each other cell with its reason.
import { describe, expect, it } from "vitest";
import { originTarget, type Relation } from "../ui/edit/origin-target.js";
import { byOrigins, originOids, originsSql, relationsOf } from "../ui/edit/origins.js";
import { refusalOf } from "../ui/edit/pending.js";
import { readsOnly, repeatedNames } from "../ui/edit/source.js";
import { setOf } from "../ui/engines/pg-result.js";
import { split } from "../ui/sql/split.js";

const column = (name: string, tableOid = 0, columnNumber = 0) => ({
  name,
  typeOid: 25,
  typeModifier: -1,
  typeSize: -1,
  tableOid,
  columnNumber,
});
const col = (attnum: number, name: string, type = "text") => ({
  attnum,
  name,
  type,
  notNull: false,
  default: null,
  updatable: true,
});
const rel = (oid: number, name: string, more: Partial<Relation> = {}): Relation => ({
  oid,
  schema: "public",
  name,
  relkind: "r",
  updatable: 28,
  columns: [col(1, "id", "integer"), col(2, "name")],
  keys: [{ primary: true, name: `${name}_pkey`, columns: [1] }],
  references: [],
  ...more,
});
const ORDERS = rel(100, "orders", {
  columns: [col(1, "id", "integer"), col(2, "person", "integer"), col(3, "total", "numeric")],
  references: [200],
});
const PEOPLE = rel(200, "people");
const relations = (...rels: Relation[]) => new Map(rels.map((r) => [r.oid, r]));
const result = (origins: [string, number, number][]) => ({
  columns: origins.map(([n]) => n),
  rows: [origins.map((_, i) => String(i + 1))],
  truncated: false,
  origins: origins.map(([, table, c]) => ({ table, column: c })),
});
const never = () => false;
const statement = (sql: string) => {
  const [first] = split(sql, "postgresql");
  if (!first) throw new Error("no statement");
  return first;
};

describe("origins of a result's columns", () => {
  it("a result column's table and column come from the session", () => {
    const set = setOf([column("id", 100, 1), column("n", 0, 0)], [["1", "2"]], 10, false);
    expect(set.origins).toEqual([
      { table: 100, column: 1 },
      { table: 0, column: 0 },
    ]);
    expect(setOf([column("n")], [], 10, false).origins).toBeUndefined();
    expect(
      originOids(
        result([
          ["a", 7, 1],
          ["b", 0, 0],
          ["c", 7, 2],
          ["d", 9, 1],
        ]),
      ),
    ).toEqual([7, 9]);
    const pg = { engine: "postgresql" } as never;
    expect(byOrigins(pg, set)).toBe(true);
    expect(byOrigins({ engine: "sqlite" } as never, set)).toBe(false);
  });

  it("reads the relations by OID in one statement and parses its rows", () => {
    const sql = originsSql([200, 100]);
    expect(sql).toContain("WHERE c.oid IN (200, 100)");
    expect(sql).toContain("pg_catalog.pg_relation_is_updatable");
    expect(sql).toContain("i.indpred IS NULL AND i.indexprs IS NULL");
    const read = relationsOf([
      [
        "100",
        "public",
        "orders",
        "r",
        "28",
        '[[1,"id","integer",true,null,true],[2,"total","numeric",false,"0",true]]',
        '[[true,"orders_pkey",[1]]]',
        "[200]",
      ],
    ]);
    expect(read.get(100)).toEqual({
      oid: 100,
      schema: "public",
      name: "orders",
      relkind: "r",
      updatable: 28,
      columns: [
        { attnum: 1, name: "id", type: "integer", notNull: true, default: null, updatable: true },
        {
          attnum: 2,
          name: "total",
          type: "numeric",
          notNull: false,
          default: "0",
          updatable: true,
        },
      ],
      keys: [{ primary: true, name: "orders_pkey", columns: [1] }],
      references: [200],
    });
  });

  it("a join is editable where each table's key is in the result", () => {
    const set = result([
      ["id", 100, 1],
      ["total", 100, 3],
      ["pid", 200, 1],
      ["name", 200, 2],
      ["twice", 0, 0],
      ["name", 200, 2],
    ]);
    const t = originTarget(set, relations(ORDERS, PEOPLE), never);
    expect(t.tables?.map((x) => [x.name, x.by, x.key, x.rank, x.insert])).toEqual([
      ["orders", "primary", [0], 1, false],
      ["people", "primary", [2], 0, false],
    ]);
    expect(t.joined).toEqual(["orders", "people"]);
    expect(t.columns.map((c) => [c.name, c.known, c.table])).toEqual([
      ["id", true, 0],
      ["total", true, 0],
      ["id", true, 1],
      ["name", true, 1],
      ["twice", false, undefined],
      ["name", false, undefined],
    ]);
    expect(t.columns[4]?.why).toBe(
      "twice is computed by the query, not read from a table: it cannot change.",
    );
    expect(t.columns[5]?.why).toBe(
      "name of people is in the result twice: change its first column.",
    );
    expect(t.key).toEqual([0, 2]);
  });

  it("says why a table whose key is missing, read twice or materialized cannot change", () => {
    const set = result([
      ["total", 100, 3],
      ["name", 200, 2],
    ]);
    const lacking = originTarget(set, relations(ORDERS, PEOPLE), never);
    expect(lacking.columns.map((c) => c.why)).toEqual([
      "The result lacks id of orders's primary key: add it to change orders's cells.",
      "The result lacks id of people's primary key: add it to change people's cells.",
    ]);
    expect(refusalOf({ name: "shop", readOnly: false }, lacking)).toMatch(
      /^No cell of this result can change\. The result lacks id of orders/u,
    );
    const both = result([
      ["id", 200, 1],
      ["name", 200, 2],
    ]);
    const twice = originTarget(both, relations(PEOPLE), (name) => name === "people");
    expect(twice.columns[1]?.why).toBe(
      "people is read more than once in this query, so which of its rows a cell shows is not certain.",
    );
    const mat = originTarget(
      both,
      relations(rel(200, "people", { relkind: "m", updatable: 0 })),
      never,
    );
    expect(mat.columns[1]?.why).toBe(
      "people is a materialized view: its rows are computed, not stored.",
    );
  });

  it("a table without a primary key is keyed by a unique NOT NULL index, else by ctid, else by every column", () => {
    const loose = { keys: [], columns: [col(1, "at", "integer"), col(2, "what")] };
    const log = rel(300, "log", loose);
    const all = result([
      ["at", 300, 1],
      ["what", 300, 2],
    ]);
    const unique = rel(300, "log", {
      ...loose,
      keys: [{ primary: false, name: "log_at", columns: [1] }],
    });
    expect(originTarget(all, relations(unique), never).tables?.[0]).toMatchObject({
      by: "unique",
      key: [0],
      match: [],
    });
    const withCtid = result([
      ["ctid", 300, -1],
      ["at", 300, 1],
      ["what", 300, 2],
    ]);
    const byCtid = originTarget(withCtid, relations(log), never);
    expect(byCtid.tables?.[0]).toMatchObject({ by: "ctid", key: [0], match: [1, 2] });
    expect(byCtid.columns[0]?.why).toBe("ctid is log's row id (ctid): the server sets it.");
    expect(byCtid.key).toEqual([0]);
    expect(originTarget(all, relations(log), never).tables?.[0]).toMatchObject({
      by: "row",
      key: [],
      match: [0, 1],
    });
    const some = originTarget(result([["what", 300, 2]]), relations(log), never);
    expect(some.columns[0]?.why).toBe(
      "log has no primary key or unique key on NOT NULL columns: select its ctid (SELECT ctid, * FROM log) or every one of its columns to change its rows.",
    );
    const parted = rel(300, "log", { ...loose, relkind: "p" });
    expect(originTarget(withCtid, relations(parted), never).tables?.[0]?.by).toBe("row");
  });

  it("a view is editable only when the server can update it", () => {
    const view = rel(400, "big", {
      relkind: "v",
      updatable: 28,
      keys: [],
      columns: [col(1, "id", "integer"), col(2, "twice", "numeric")],
    });
    view.columns[1] = { ...col(2, "twice", "numeric"), updatable: false };
    const set = result([
      ["id", 400, 1],
      ["twice", 400, 2],
    ]);
    const t = originTarget(set, relations(view), never);
    expect(t.tables?.[0]).toMatchObject({ kind: "view", by: "row", insert: true, delete: true });
    expect(t.columns.map((c) => c.known)).toEqual([true, false]);
    expect(t.columns[1]?.why).toBe("twice is computed by view big: it cannot change.");
    const fixed = originTarget(set, relations({ ...view, updatable: 0 }), never);
    expect(fixed.tables).toEqual([]);
    expect(fixed.columns[0]?.why).toMatch(
      /^View big cannot be updated: the server changes a view/u,
    );
  });

  it("maps only a statement that reads, and finds names it reads twice", () => {
    expect(readsOnly(statement("select * from t for no key update"))).toBe(true);
    expect(readsOnly(statement("with x as (select 1) select * from x"))).toBe(true);
    expect(readsOnly(statement("with d as (delete from t returning *) select * from d"))).toBe(
      false,
    );
    expect(readsOnly(statement("select * into copy from t"))).toBe(false);
    expect(readsOnly(statement("insert into t values (1) returning *"))).toBe(false);
    const self = repeatedNames(
      statement("select a.id, b.name from t a join t b on b.id = a.id"),
      "postgresql",
    );
    expect([self("t"), self("a")]).toEqual([true, false]);
    const join = repeatedNames(
      statement('select o.id, p.name from public.orders o join "people" p on p.id = o.person'),
      "postgresql",
    );
    expect([join("orders"), join("people"), join("public")]).toEqual([false, false, false]);
    const cte = repeatedNames(
      statement("with x as (select * from t) select * from x a join x b on true"),
      "postgresql",
    );
    expect(cte("t")).toBe(true);
    const once = repeatedNames(
      statement("with x as (select * from t) select * from x"),
      "postgresql",
    );
    expect(once("t")).toBe(false);
  });
});
