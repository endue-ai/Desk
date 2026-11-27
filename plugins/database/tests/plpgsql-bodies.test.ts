// Where PL/pgSQL is written in a script and what shape a body has (PG-35, ADR 0343): the bodies of
// CREATE FUNCTION, CREATE PROCEDURE and DO that are PL/pgSQL, with the routine's parameters, and no
// other; then a body's blocks and declarations as the editor's highlighting, folding and completion
// read them, also while the body is half typed.
import { describe, expect, it } from "vitest";
import { bodiesIn, bodyAt } from "../ui/sql/plpgsql/bodies.js";
import { outlineOf } from "../ui/sql/plpgsql/outline.js";

const inside = (sql: string) => bodiesIn(sql).map((b) => sql.slice(b.from, b.to));

describe("PL/pgSQL bodies in a script", () => {
  it("finds the bodies of a corpus of routines, with LANGUAGE before or after AS", () => {
    const corpus = [
      "create function f(a int) returns int language plpgsql as $$ begin return a; end $$;",
      "CREATE OR REPLACE FUNCTION public.f(a integer)\n RETURNS integer\n LANGUAGE plpgsql\nAS $function$\nbegin return a; end\n$function$;",
      "create procedure p() as $body$ begin null; end $body$ language 'plpgsql';",
      'create function g() returns setof int language "plpgsql" as $q$ begin return next 1; end $q$;',
      "do $$ begin raise notice 'hi'; end $$;",
      "do language plpgsql $$ begin null; end $$;",
    ];
    expect(corpus.map((sql) => inside(sql))).toEqual([
      [" begin return a; end "],
      ["\nbegin return a; end\n"],
      [" begin null; end "],
      [" begin return next 1; end "],
      [" begin raise notice 'hi'; end "],
      [" begin null; end "],
    ]);
  });

  it("leaves every other body as text: other languages, BEGIN ATOMIC, a single-quoted body", () => {
    const others = [
      "create function f() returns int language sql as $$ select 1 $$;",
      "create function f() returns int language plpython3u as $$ return 1 $$;",
      "create function f() returns int as 'obj', 'sym' language c;",
      "create function f() returns int language sql begin atomic select 1; end;",
      "create function f() returns int language plpgsql as 'begin return 1; end';",
      "do language plperl $$ print 1 $$;",
      "select $$ begin return 1; end $$;",
    ];
    for (const sql of others) expect([sql, bodiesIn(sql)]).toEqual([sql, []]);
  });

  it("reads the parameters with their modes and types, and finds the body at an offset", () => {
    const sql =
      "create function f(a int, out b text, inout c numeric(10,2) default 1, double precision, variadic v int[]) returns record language plpgsql as $$ begin end $$; select 1";
    const [body] = bodiesIn(sql);
    expect(body?.params.map((p) => [p.mode, p.name, p.type])).toEqual([
      ["IN", "a", "int"],
      ["OUT", "b", "text"],
      ["INOUT", "c", "numeric(10,2)"],
      ["IN", "", "double precision"],
      ["VARIADIC", "v", "int[]"],
    ]);
    expect(body?.returns).toBe("record");
    expect(bodyAt(sql, sql.indexOf("begin"))?.kind).toBe("function");
    expect(bodyAt(sql, sql.indexOf("select 1"))).toBeNull();
  });
});

describe("the outline of a body", () => {
  const body = [
    "<<outer>>",
    "declare",
    "  c constant int := 2;",
    "  r public.people%rowtype;",
    "  n people.name%type;",
    "  rec record;",
    "  cur cursor for select 1;",
    "  al alias for $1;",
    "begin",
    "  for i in 1..10 loop",
    "    x := case when i > 1 then 1 else 2 end;",
    "    if i = 2 then exit; end if;",
    "  end loop;",
    "  case c when 1 then null; else null; end case;",
    "  declare z int; begin z := 1; end;",
    "end",
  ].join("\n");

  it("gives the blocks and the statements that nest, each with its END", () => {
    const o = outlineOf(body);
    expect(
      o.constructs.map((c) => [
        c.kind,
        body.slice(c.from, c.from + 7),
        c.end === null ? null : body.slice(c.end, c.to ?? 0),
      ]),
    ).toEqual([
      ["block", "declare", "end"],
      ["loop", "for i i", "end loop"],
      ["if", "if i = ", "end if"],
      ["case", "case c ", "end case"],
      ["block", "declare", "end"],
    ]);
    expect(o.labels).toEqual(["outer"]);
  });

  it("gives the declarations with their kinds, types and reach", () => {
    const o = outlineOf(body, 100);
    expect(o.decls.map((d) => [d.name, d.kind, d.type, d.rowtype, d.typeOf])).toEqual([
      ["c", "constant", "int", null, null],
      ["r", "variable", "public.people%rowtype", ["public", "people"], null],
      ["n", "variable", "people.name%type", null, ["people", "name"]],
      ["rec", "record", "record", null, null],
      ["cur", "cursor", "cursor", null, null],
      ["al", "alias", "alias for $1", null, null],
      ["i", "loop", "integer", null, null],
      ["z", "variable", "int", null, null],
    ]);
    const z = o.decls.find((d) => d.name === "z");
    expect(body.slice((z?.from ?? 0) - 100, (z?.to ?? 0) - 100)).toBe("; begin z := 1; ");
    expect(o.tokens[0]?.start).toBe(100);
  });

  it("is read while the body is half typed", () => {
    const o = outlineOf("declare\n  a int;\n  b te");
    expect(o.decls.map((d) => d.name)).toEqual(["a", "b"]);
    const p = outlineOf("begin\n  if a > 0 then\n    loop\n      ");
    expect(p.constructs.map((c) => [c.kind, c.end])).toEqual([
      ["block", null],
      ["if", null],
      ["loop", null],
    ]);
  });
});
