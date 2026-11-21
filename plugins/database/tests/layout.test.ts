// Format SQL for PostgreSQL (ADR 0291): a statement laid out again from PostgreSQL's own scanner and
// parse tree, by a style. The default style on a messy statement, comments where they were, each
// style setting, and a statement that does not parse (or a BEGIN ATOMIC body) left as written.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createLayout } from "../ui/sql/layout/layout.js";
import { STYLE } from "../ui/sql/layout/style.js";
import { loadLibpgQuery } from "../ui/sql/parse/wasm.js";
import { WASM } from "./pg-parser";

let layout: ReturnType<typeof createLayout>;
beforeAll(async () => {
  layout = createLayout(await loadLibpgQuery(readFileSync(WASM)));
});

const lines = (...rows: string[]) => rows.join("\n");

const WIDE =
  "select p.id, p.name, p.note, count(o.id) as orders, sum(o.total) as spent, max(o.at) as last_order from people p left join orders o on o.person = p.id and o.total > 0 and o.at > now() - interval '1 year' where p.note is not null and p.name like 'A%' and p.id between 1 and 1000 group by p.id, p.name, p.note order by spent desc";

const TAIL = [
  "WHERE p.note IS NOT NULL AND p.name LIKE 'A%' AND p.id BETWEEN 1 AND 1000",
  "GROUP BY p.id, p.name, p.note",
  "ORDER BY spent DESC",
];

describe("Format SQL's layout", () => {
  it("lays a messy SELECT out by the default style", () => {
    const messy =
      "select p.id,p.name , count(o.id) as orders,sum(o.total) total\nfrom people p left   join orders o on o.person=p.id and o.total>0\nwhere p.note is not null and (p.name like 'A%' or p.id between 1 and 10) group by p.id,p.name having count(o.id)>1 order by orders desc limit 10";
    expect(layout(messy).text).toBe(
      lines(
        "SELECT p.id, p.name, count(o.id) AS orders, sum(o.total) total",
        "FROM people p",
        "LEFT JOIN orders o ON o.person = p.id AND o.total > 0",
        "WHERE p.note IS NOT NULL AND (p.name LIKE 'A%' OR p.id BETWEEN 1 AND 10)",
        "GROUP BY p.id, p.name",
        "HAVING count(o.id) > 1",
        "ORDER BY orders DESC",
        "LIMIT 10",
      ),
    );
    expect(layout(WIDE).text).toBe(
      lines(
        "SELECT",
        "    p.id,",
        "    p.name,",
        "    p.note,",
        "    count(o.id) AS orders,",
        "    sum(o.total) AS spent,",
        "    max(o.at) AS last_order",
        "FROM people p",
        "LEFT JOIN orders o",
        "    ON o.person = p.id AND o.total > 0 AND o.at > now() - interval '1 year'",
        ...TAIL,
      ),
    );
    expect(layout(WIDE)).toMatchObject({ from: 0, to: WIDE.length, laid: 1, refused: 0 });
    // A keyword the grammar reads as a name keeps its spelling; USER here is the function.
    expect(layout("select key, value, user, Level from options").text).toBe(
      "SELECT key, value, USER, Level\nFROM options",
    );
    // A type is written as PostgreSQL's documentation writes it, in lower case.
    expect(
      layout("create table t (id INTEGER primary key, at TIMESTAMP(3) WITH TIME ZONE not null)")
        .text,
    ).toBe(
      lines(
        "CREATE TABLE t (",
        "    id integer PRIMARY KEY,",
        "    at timestamp(3) with time zone NOT NULL",
        ")",
      ),
    );
  });

  it("keeps every comment where it was attached", () => {
    const sql =
      "-- report\nselect id, -- the key\n  name /* who */, note\n  -- only some\n  from people where id > 1 /* big */ and name is not null -- named\n order by id;\n\n-- the next one\nselect 1 ;select 2;  /* end */";
    const laid = layout(sql).text;
    expect(laid).toBe(
      lines(
        "-- report",
        "SELECT",
        "    id, -- the key",
        "    name /* who */,",
        "    note",
        "-- only some",
        "FROM people",
        "WHERE id > 1 /* big */",
        "    AND name IS NOT NULL -- named",
        "ORDER BY id;",
        "",
        "-- the next one",
        "SELECT 1;",
        "",
        "SELECT 2;  /* end */",
      ),
    );
    const comments = (text: string) => text.match(/--[^\n]*|\/\*.*?\*\//gu);
    expect(comments(laid)).toEqual(comments(sql));
    // A line comment ends its line, so what follows it starts the next one.
    expect(
      layout("select a, /* x */ b from t -- y\nwhere c = 1 -- w\n;", { oneLine: "statement" }).text,
    ).toBe(lines("SELECT a, /* x */ b", "FROM t -- y", "WHERE c = 1 -- w", ";"));
  });

  it("follows each style setting", () => {
    expect(STYLE).toEqual({
      keywordCase: "upper",
      indent: 4,
      lineWidth: 80,
      comma: "last",
      andOr: "before",
      joins: "flat",
      oneLine: "clause",
      lists: "indent",
    });
    const mixed = 'Select ID, "Order", Name from People p WHERE p.Name ilike $1 Order By "Order"';
    expect(layout(mixed, { keywordCase: "lower" }).text).toBe(
      lines(
        'select ID, "Order", Name',
        "from People p",
        "where p.Name ilike $1",
        'order by "Order"',
      ),
    );
    expect(layout(mixed, { keywordCase: "preserve" }).text).toBe(
      lines(
        'Select ID, "Order", Name',
        "from People p",
        "WHERE p.Name ilike $1",
        'Order By "Order"',
      ),
    );
    const select = (indent: string, comma: "last" | "first") =>
      [
        "p.id",
        "p.name",
        "p.note",
        "count(o.id) AS orders",
        "sum(o.total) AS spent",
        "max(o.at) AS last_order",
      ].map((item, i, all) =>
        comma === "first"
          ? `${indent}${i === 0 ? "" : ", "}${item}`
          : `${indent}${item}${i < all.length - 1 ? "," : ""}`,
      );
    const on = "ON o.person = p.id AND o.total > 0 AND o.at > now() - interval '1 year'";
    const join = (indent: string) => [`${indent}LEFT JOIN orders o`, `${indent}    ${on}`];
    expect(layout(WIDE, { indent: 2 }).text.split("\n").slice(0, 3)).toEqual([
      "SELECT",
      "  p.id,",
      "  p.name,",
    ]);
    expect(layout(WIDE, { comma: "first" }).text).toBe(
      lines("SELECT", ...select("    ", "first"), "FROM people p", ...join(""), ...TAIL),
    );
    expect(layout(WIDE, { joins: "indented" }).text).toBe(
      lines("SELECT", ...select("    ", "last"), "FROM people p", ...join("    "), ...TAIL),
    );
    expect(layout(WIDE, { lists: "align" }).text.split("\n").slice(0, 3)).toEqual([
      "SELECT p.id,",
      "       p.name,",
      "       p.note,",
    ]);
    expect(layout(WIDE, { lists: "align", comma: "first" }).text.split("\n").slice(0, 3)).toEqual([
      "SELECT p.id",
      "     , p.name",
      "     , p.note",
    ]);
    expect(layout(WIDE, { lineWidth: 120 }).text.split("\n").slice(0, 3)).toEqual([
      "SELECT p.id, p.name, p.note, count(o.id) AS orders, sum(o.total) AS spent, max(o.at) AS last_order",
      "FROM people p",
      "LEFT JOIN orders o ON o.person = p.id AND o.total > 0 AND o.at > now() - interval '1 year'",
    ]);
    const where =
      "select id from people where note is not null and name like 'A%' and id between 1 and 1000 or id = 0";
    expect(layout(where, { lineWidth: 40 }).text).toBe(
      lines(
        "SELECT id",
        "FROM people",
        "WHERE note IS NOT NULL",
        "    AND name LIKE 'A%'",
        "    AND id BETWEEN 1 AND 1000",
        "    OR id = 0",
      ),
    );
    expect(layout(where, { lineWidth: 40, andOr: "after" }).text).toBe(
      lines(
        "SELECT id",
        "FROM people",
        "WHERE note IS NOT NULL AND",
        "    name LIKE 'A%' AND",
        "    id BETWEEN 1 AND 1000 OR",
        "    id = 0",
      ),
    );
    const short = "select a, b from t where c = 1 and d = 2 order by a";
    expect(layout(short, { oneLine: "statement" }).text).toBe(
      "SELECT a, b FROM t WHERE c = 1 AND d = 2 ORDER BY a",
    );
    expect(layout(short, { oneLine: "item" }).text).toBe(
      lines("SELECT", "    a,", "    b", "FROM t", "WHERE c = 1", "    AND d = 2", "ORDER BY a"),
    );
    // A value that is not one of the choices, or out of range, keeps the default.
    expect(layout(short, { keywordCase: "shout", indent: 99, lineWidth: 2 }).text).toBe(
      layout(short).text,
    );
  });

  it("leaves a statement that does not parse as it is and says so", () => {
    const sql =
      "select 1;\nselec oops;\ncreate function add(a int, b int) returns int language sql begin atomic select a + b; end;\nselect   2";
    expect(layout(sql)).toEqual({
      from: 0,
      to: sql.length,
      text: "SELECT 1;\nselec oops;\ncreate function add(a int, b int) returns int language sql begin atomic select a + b; end;\nSELECT 2",
      laid: 2,
      left: [{ line: 2, column: 1, message: 'syntax error at or near "selec"' }],
      kept: 1,
      refused: 0,
    });
    // The statement at the caret: only its text is replaced.
    const script = "select 1;\nselect a,b from t where x=1;\nselect 3";
    expect(layout(script, {}, { at: 15 })).toMatchObject({
      from: 10,
      to: 37,
      text: "SELECT a, b\nFROM t\nWHERE x = 1",
      laid: 1,
    });
    expect(layout("select (1", {}, { at: 3 })).toMatchObject({
      text: "select (1",
      laid: 0,
      left: [{ line: 1, column: 10, message: "syntax error at end of input" }],
    });
    expect(layout("   ")).toMatchObject({ text: "   ", laid: 0, left: [] });
  });
});
