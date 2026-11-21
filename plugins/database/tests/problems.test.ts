// The SQL problems the editor underlines (PG-30, ADR 0294), as the parse worker's checker finds them:
// syntax errors with the server's own message at its token, names that bind to nothing in the cached
// schema with what was looked for and where, ambiguous columns, INSERT column counts, aliases used
// before they are defined, and nothing where the cache cannot tell.
import { describe, expect, it } from "vitest";
import { checker, problemsOf, WITH_CATALOG } from "./problems-fixture";

const PATH = '(search path: "$user", public)';

describe("SQL problems", () => {
  it("a syntax error is the parser's message at its token", async () => {
    expect(await problemsOf("selec 1")).toEqual([["selec", 'syntax error at or near "selec"']]);
    expect(await problemsOf("select 1 frm people")).toEqual([
      ["people", 'syntax error at or near "people"'],
    ]);
    // At the end of the input the server points past the last token: so does the problem.
    const open = await checker();
    const [end] = open.check({ sql: "select (1 + 2" }).problems;
    expect(end).toMatchObject({ from: 13, to: 13, message: "syntax error at end of input" });
    expect(await problemsOf("select 'unterminated")).toEqual([
      ["'unterminated", 'unterminated quoted string at or near "\'unterminated"'],
    ]);
    // One per broken statement; the statements around it keep theirs.
    const script = "select 1;\nselec 2;\nselect emial from people;\nselect 'é', name frm people";
    expect(await problemsOf(script)).toEqual([
      ["selec", 'syntax error at or near "selec"'],
      [
        "emial",
        'column "emial" does not exist\nPerhaps you meant to reference the column "people.email".',
      ],
      ["people", 'syntax error at or near "people"'],
    ]);
    expect(await problemsOf(script, { syntax: false })).toEqual([
      [
        "emial",
        'column "emial" does not exist\nPerhaps you meant to reference the column "people.email".',
      ],
    ]);
  });

  it("names that bind to nothing say what was looked for and where", async () => {
    expect(await problemsOf("select * from peple")).toEqual([
      ["peple", `relation "peple" does not exist ${PATH}\nPerhaps you meant "people".`],
    ]);
    expect(await problemsOf("select * from nosuch.people")).toEqual([
      ["nosuch.people", 'relation "nosuch.people" does not exist\nThere is no schema "nosuch".'],
    ]);
    expect(await problemsOf("select * from public.ghost")).toEqual([
      ["public.ghost", 'relation "public.ghost" does not exist'],
    ]);
    expect(await problemsOf("select p.emial from people p")).toEqual([
      [
        "p.emial",
        'column p.emial does not exist\nPerhaps you meant to reference the column "p.email".',
      ],
    ]);
    expect(await problemsOf("select nosuch.f(1)")).toEqual([
      ["nosuch", 'schema "nosuch" does not exist'],
    ]);
    // A relation the path does not reach but another schema holds says where it is.
    expect(await problemsOf("select * from people", { searchPath: ["nowhere"] })).toEqual([
      [
        "people",
        'relation "people" does not exist (search path: nowhere)\nOff the search path: app.people, public.people.',
      ],
    ]);
    expect(await problemsOf("select x.id from people p")).toEqual([
      ["x", 'missing FROM-clause entry for table "x"'],
    ]);
    expect(await problemsOf("insert into people (id, nope) values (1, 2)")).toEqual([
      ["nope", 'column "nope" of relation "people" does not exist'],
    ]);
    expect(await problemsOf("update people set nope = 1")).toEqual([
      ["nope", 'column "nope" of relation "people" does not exist'],
    ]);
    // A cast is not one of psql's variables: the statement is checked.
    expect(await problemsOf("select emial::text from people")).toHaveLength(1);
    // Offsets count in the editor's units past characters outside ASCII.
    const wide = "select '😀 한';\nselect emial from people";
    const c = await checker();
    const [found] = c.check({ sql: wide }).problems;
    expect(wide.slice(found?.from, found?.to)).toBe("emial");
    expect(found?.kind).toBe("names");
  });

  it("an ambiguous column, a wrong number of INSERT columns and an alias used before it is defined", async () => {
    expect(await problemsOf("select id from people, orders")).toEqual([
      ["id", 'column reference "id" is ambiguous'],
    ]);
    expect(await problemsOf("insert into people (id, name) values (1)")).toEqual([
      ["name", "INSERT has more target columns than expressions"],
    ]);
    expect(await problemsOf("insert into people (id) values (1, 2)")).toEqual([
      ["2", "INSERT has more expressions than target columns"],
    ]);
    expect(await problemsOf("insert into people values (1, 'a', 'b', 'c')")).toEqual([
      ["'c'", "INSERT has more expressions than target columns"],
    ]);
    expect(await problemsOf("insert into people (id, name) select 1")).toEqual([
      ["name", "INSERT has more target columns than expressions"],
    ]);
    // Fewer values than the table's columns without a column list is the server's default.
    expect(await problemsOf("insert into people values (1)")).toEqual([]);
    expect(
      await problemsOf(
        "select * from people a join orders b on b.person = c.id join people c on c.id = a.id",
      ),
    ).toEqual([
      [
        "c",
        'missing FROM-clause entry for table "c"\n"c" is in FROM, but not where this part of the query can see it: a JOIN\'s ON sees only its own two sides.',
      ],
    ]);
    const alias =
      'column "d" does not exist\n"d" is a name the select list gives; only ORDER BY and GROUP BY can use it.';
    expect(await problemsOf("select id * 2 as d, d + 1 from people")).toEqual([["d", alias]]);
    expect(await problemsOf("select id as d from people where d > 1")).toEqual([["d", alias]]);
    expect(await problemsOf("select id as d from people order by d")).toEqual([]);
  });

  it("nothing is reported where it cannot be told", async () => {
    const none = [
      "select * from later.anything",
      "select ctid, xmin, xmax, cmin, cmax, tableoid from people",
      "select last_value from people_id_seq",
      "alter table if exists ghost add column x int",
      "\\set id 1",
      "select * from ghost where id = :id",
      "select * from ghost where name = :'name' and :\"column\" > 1",
      "select * from ghost where doc ? 'k'",
      // The cache leaves out aggregates, window functions and what extensions bring: a function
      // is never told missing, only its schema.
      "select nope(1)",
      "select public.nope(1), public.touch()",
      "create table if not exists t (a int);\nselect a, b from t",
      "create view v as select 1 as one;\nselect one, two from v",
      "create schema s;\ncreate table s.t (a int);\nselect * from s.t, s.u",
      "create extension postgis;\nselect * from spatial_ref_sys",
      "create function public.f() returns int language sql return 1;\nselect public.f()",
      "alter table people rename to persons;\nselect * from persons",
      "alter table people add column age int;\nselect age from people",
      "create temp table tt (a int);\nselect * from tt",
      "select * into newt from people;\nselect * from newt",
      "create table t2 as select 1;\nselect * from t2",
      "create materialized view mv as select 1;\nselect * from mv",
      "alter table orders set schema app;\nselect total from app.orders",
    ];
    for (const sql of none) expect([sql, await problemsOf(sql)]).toEqual([sql, []]);
    expect(await problemsOf("select * from ghost", { searchPath: ["later", "public"] })).toEqual(
      [],
    );
    expect(await problemsOf("select now(), count(*), nope(1)", {}, WITH_CATALOG)).toEqual([]);
    // A partition the cache read under its root binds, with the root's columns; another does not.
    expect(
      await problemsOf("select at from ev_2024", { searchPath: ["public", "metrics"] }),
    ).toEqual([]);
    expect(await problemsOf("select * from metrics.events_2026")).toEqual([
      ["metrics.events_2026", 'relation "metrics.events_2026" does not exist'],
    ]);
    expect(await problemsOf("select emial from metrics.ev_2024")).toEqual([
      ["emial", 'column "emial" does not exist'],
    ]);
    // A table the script creates has the columns it was given.
    expect(await problemsOf("create table t (a int);\nselect a, b from t")).toEqual([
      ["b", 'column "b" does not exist'],
    ]);
    // A typo after a definition is still one.
    expect(await problemsOf("create table things (a int);\nselect * from thigns")).toEqual([
      ["thigns", `relation "thigns" does not exist ${PATH}\nPerhaps you meant "things".`],
    ]);
    // Without a model only syntax is told.
    const c = await checker();
    expect(c.check({ sql: "select * from ghost;\nselec" }, null).problems).toHaveLength(1);
  });

  it("SET search_path and set_config steer the statements after them", async () => {
    expect(await problemsOf("set search_path to app;\nselect email from people")).toEqual([]);
    expect(await problemsOf("set search_path to app;\nselect name from people")).toEqual([
      ["name", 'column "name" does not exist'],
    ]);
    expect(
      await problemsOf("set search_path to app;\nreset search_path;\nselect name from people"),
    ).toEqual([]);
    expect(await problemsOf("set local search_path = 'app';\nselect email from people")).toEqual(
      [],
    );
    expect(
      await problemsOf(
        "select pg_catalog.set_config('search_path', '', false);\nselect 1 from people",
      ),
    ).toEqual([
      [
        "people",
        'relation "people" does not exist (search path is empty)\nOff the search path: app.people, public.people.',
      ],
    ]);
    expect(await problemsOf("select name from people", { searchPath: ["app", "public"] })).toEqual([
      ["name", 'column "name" does not exist'],
    ]);
    expect(
      await problemsOf("select name from people", { searchPath: ["$user", "public"], user: "app" }),
    ).toHaveLength(1);
  });
});
