// The problems inside PL/pgSQL bodies (PG-35, ADR 0343), as the parse worker's check finds them over
// a corpus of routines: a name used where only a variable can stand that nothing declares, a
// variable declared and never used, code after RETURN, RAISE EXCEPTION or an EXIT that cannot run,
// and a syntax error with PostgreSQL's PL/pgSQL grammar's message on its line. A clean corpus and
// every other language report nothing; each kind follows its setting.
import { describe, expect, it } from "vitest";
import { checker } from "./problems-fixture";

const fn = (...lines: string[]) =>
  `create function f(a int, b text) returns int language plpgsql as $$\n${lines.join("\n")}\n$$`;

/** Each problem as [kind or warning rule, the text it marks, its message's first line]. */
async function told(sql: string, more: Record<string, unknown> = {}) {
  const c = await checker();
  return c
    .check({ sql, warnings: true, ...more })
    .problems.map((p) => [
      p.kind === "warning" ? (p as { rule?: string }).rule : p.kind,
      sql.slice(p.from, p.to),
      p.message.split("\n")[0],
    ]);
}

/** Routines the server creates and runs: nothing is told. */
const CLEAN = [
  fn("declare x int := 1;", "begin", "  x := x + a;", "  return x;", "end"),
  fn(
    "declare r people%rowtype;",
    "begin",
    "  select * into r from people where id = a;",
    "  return r.id;",
    "end",
  ),
  fn(
    "begin",
    "  for i in 1..a loop",
    "    raise notice '%', i;",
    "  end loop;",
    "  return 0;",
    "end",
  ),
  fn(
    "declare n int;",
    "begin",
    "  select count(*) into n from people where name = b;",
    "  if not found then return 0; end if;",
    "  return n;",
    "end",
  ),
  fn("begin", "  perform touch();", "  return (select max(id) from people where name = b);", "end"),
  fn("<<blk>>", "declare x int;", "begin", "  blk.x := 1;", "  return blk.x;", "end"),
  fn(
    "begin",
    "  return a;",
    "exception when others then",
    "  raise notice '% %', sqlstate, sqlerrm;",
    "  return -1;",
    "end",
  ),
  "create function t() returns trigger language plpgsql as $$ begin new.id := old.id + tg_nargs; return new; end $$",
  "do $$ declare r record; begin for r in select id from people loop raise notice '%', r.id; end loop; end $$",
  "create procedure p(inout total int) language plpgsql as $body$ begin total := total + 1; commit; end $body$",
  fn(
    "begin",
    "  update people set name = b where id = (select id where name = b);",
    "  return 1;",
    "end",
  ),
];

describe("problems inside PL/pgSQL bodies", () => {
  it("tells nothing on a corpus of routines the server runs", async () => {
    for (const sql of CLEAN) expect([sql, await told(sql)]).toEqual([sql, []]);
  });

  it("tells a variable used and never declared where only a variable can stand", async () => {
    expect(
      await told(fn("declare x int;", "begin", "  x := a + y;", "  return x;", "end")),
    ).toEqual([["names", "y", 'column "y" does not exist']]);
    expect(
      await told(
        fn(
          "declare total int;",
          "begin",
          "  if totl > 0 then return 1; end if;",
          "  return total;",
          "end",
        ),
      ),
    ).toEqual([["names", "totl", 'column "totl" does not exist']]);
    const sql = fn("declare total int;", "begin", "  return totl;", "end");
    const c = await checker();
    expect(c.check({ sql }).problems[0]?.message).toContain('Perhaps you meant "total".');
    // A name under a FROM may be a column: never told.
    expect(await told(fn("begin", "  return (select nope from people limit 1);", "end"))).toEqual(
      [],
    );
  });

  it("warns of a variable declared and never used", async () => {
    expect(
      await told(
        fn("declare", "  used int := 1;", "  spare text;", "begin", "  return used;", "end"),
      ),
    ).toEqual([["unused-variable", "spare", "spare is declared and never used."]]);
  });

  it("warns of code after RETURN, RAISE EXCEPTION or an EXIT without WHEN", async () => {
    expect(await told(fn("begin", "  return 1;", "  raise notice 'never';", "end"))).toEqual([
      [
        "unreachable-code",
        "raise notice 'never';",
        "This never runs: the RETURN on line 3 of the body ends the routine before it.",
      ],
    ]);
    expect(await told(fn("begin", "  raise exception 'no';", "  return 2;", "end"))).toEqual([
      [
        "unreachable-code",
        "return 2;",
        "This never runs: the RAISE EXCEPTION on line 3 of the body raises before it.",
      ],
    ]);
    expect(
      await told(
        fn("begin", "  loop", "    exit;", "    perform 1;", "  end loop;", "  return 0;", "end"),
      ),
    ).toEqual([
      [
        "unreachable-code",
        "perform 1;",
        "This never runs: the EXIT on line 4 of the body leaves before it.",
      ],
    ]);
    expect(
      await told(
        fn(
          "begin",
          "  loop",
          "    exit when a > 1;",
          "    perform 1;",
          "  end loop;",
          "  return 0;",
          "end",
        ),
      ),
    ).toEqual([]);
  });

  it("tells a syntax error with the grammar's message on its line of the body", async () => {
    const cases: Array<[string, string, string, number]> = [
      [
        fn("begin", "  if a > 0 then", "    return 1", "  end if;", "end"),
        "if",
        'syntax error at or near "if"',
        5,
      ],
      [fn("begin", "  return a +;", "end"), ";", "syntax error at end of input", 3],
      [fn("begin", "  select from where;", "end"), "where", 'syntax error at or near "where"', 3],
      [
        fn("begin", "  nope := 1;", "  return 1;", "end"),
        "nope",
        '"nope" is not a known variable',
        3,
      ],
      [
        fn("declare x int;", "begin", "  x := 1;", "  retrun x;", "end"),
        "retrun",
        'syntax error at or near "retrun"',
        5,
      ],
    ];
    const c = await checker();
    for (const [sql, marked, message, line] of cases) {
      const problems = c.check({ sql }).problems;
      expect([sql, problems.map((p) => [p.kind, sql.slice(p.from, p.to), p.message])]).toEqual([
        sql,
        [["syntax", marked, `${message}\nPL/pgSQL, line ${line} of the body.`]],
      ]);
    }
  });

  it("follows each kind's setting and leaves other languages alone", async () => {
    const sql = fn("declare spare int;", "begin", "  return y;", "  perform 1;", "end");
    expect((await told(sql)).map(([k]) => k)).toEqual([
      "unused-variable",
      "names",
      "unreachable-code",
    ]);
    expect((await told(sql, { names: false })).map(([k]) => k)).toEqual([
      "unused-variable",
      "unreachable-code",
    ]);
    expect((await told(sql, { warnings: false })).map(([k]) => k)).toEqual(["names"]);
    expect((await told(sql, { off: ["unused-variable"] })).map(([k]) => k)).toEqual([
      "names",
      "unreachable-code",
    ]);
    expect(await told(fn("begin", "  if then", "end"), { syntax: false })).toEqual([]);
    expect(await told("create function g() returns int language sql as $$ select nope $$")).toEqual(
      [],
    );
    expect(
      await told("create function g() returns int language plpython3u as $$ return y $$"),
    ).toEqual([]);
  });

  it("parses an edited routine again alone", async () => {
    const c = await checker();
    const list = [
      fn("begin", "  return a;", "end"),
      "select id from people",
      fn("begin", "  return b;", "end"),
    ];
    c.check({ sql: list.join(";\n") });
    c.parsed.length = 0;
    list[2] = fn("begin", "  return 1;", "end");
    expect(c.check({ sql: list.join(";\n") }).parsed).toBe(1);
  });
});
