// The resolver (ADR 0283): every name of a parsed script bound to what the server would bind it to in
// the schema the plugin holds, or listed unbound with why. Each name reads as "<text at its
// position>: <what it is>", so a wrong position shows as wrong text.
import { describe, expect, it } from "vitest";
import type { SchemaModel } from "../ui/sql/parse/model.js";
import { type ResolveOptions, resolve } from "../ui/sql/parse/resolve.js";
import type { Name, Source, Target } from "../ui/sql/parse/scope.js";
import { loadParse, MODEL } from "./pg-parser";

function show(target: Target | Source): string {
  switch (target.kind) {
    case "relation":
      return `${target.schema}.${target.name}`;
    case "cte":
      return `cte ${target.name}`;
    case "subquery":
      return `(${target.alias})`;
    case "function":
      return `${target.schema}.${target.name}()`;
    case "table function":
      return target.name;
    case "join":
      return `join ${target.alias}`;
    case "schema":
      return `schema ${target.name}`;
    case "column":
      return `${show(target.of)}.${target.name}`;
    case "range":
      return `= ${show(target.of)}`;
    case "output":
      return `output ${target.name}`;
  }
}

const line = (sql: string, n: Name) =>
  `${sql.slice(n.start.offset, n.end.offset)}: ${n.target ? show(n.target) : `? ${n.reason}`}`;

async function bind(sql: string, options?: ResolveOptions, model: SchemaModel = MODEL) {
  const parse = await loadParse();
  const parsed = parse(sql);
  expect(parsed.statements.every((s) => s.tree)).toBe(true);
  const resolution = resolve(sql, parsed, model, options);
  return {
    names: resolution.names.map((n) => line(sql, n)),
    unbound: resolution.unbound.map((n) => line(sql, n)),
    resolution,
  };
}

const CATALOG: SchemaModel = {
  schemas: [
    ...MODEL.schemas,
    {
      name: "pg_catalog",
      relations: [{ name: "pg_tables", kind: "view", columns: [{ name: "tablename" }] }],
      routines: [{ name: "now", kind: "function", args: "" }],
    },
  ],
};

describe("resolve", () => {
  it("finds relations through the search path, $user and pg_catalog first", async () => {
    expect((await bind("select * from people")).names).toEqual(["people: public.people"]);
    expect((await bind("select * from people", { searchPath: ["app", "public"] })).names).toEqual([
      "people: app.people",
    ]);
    const user = { searchPath: ["$user", "public"], user: "app" };
    expect((await bind("select email from people", user)).names).toEqual([
      "people: app.people",
      "email: app.people.email",
    ]);
    expect((await bind("select * from pg_class, ghost")).names).toEqual([
      "pg_class: ? unread",
      "ghost: ? missing",
    ]);
    const tables = { ...CATALOG, schemas: [...CATALOG.schemas] };
    tables.schemas[0] = {
      ...MODEL.schemas[0],
      name: "public",
      relations: [{ name: "pg_tables", kind: "table", columns: [] }],
    };
    expect((await bind("select * from pg_tables", {}, tables)).names).toEqual([
      "pg_tables: pg_catalog.pg_tables",
    ]);
    const after = { searchPath: ["public", "pg_catalog"] };
    expect((await bind("select * from pg_tables", after, tables)).names).toEqual([
      "pg_tables: public.pg_tables",
    ]);
  });

  it("binds schema-qualified names and says which schemas were not read", async () => {
    const { names } = await bind(
      "select public.people.note, people.name from public.people, later.thing, nowhere.thing",
    );
    expect(names).toEqual([
      "public: schema public",
      "people: public.people",
      "later: schema later",
      "thing: ? unread",
      "nowhere: ? missing",
      "thing: ? missing",
      "public: schema public",
      "people: = public.people",
      "note: public.people.note",
      "people: = public.people",
      "name: public.people.name",
    ]);
    expect((await bind("select x from information_schema.tables")).names).toEqual([
      "information_schema: ? unread",
      "tables: ? unread",
      "x: ? unread",
    ]);
  });

  it("binds aliases and refuses names the alias hides or two items share", async () => {
    const { names } = await bind("select o.total, orders.id, id, o.nope from orders as o, people");
    expect(names).toEqual([
      "orders: public.orders",
      "people: public.people",
      "o: = public.orders",
      "total: public.orders.total",
      "orders: ? missing",
      "id: ? ambiguous",
      "o: = public.orders",
      "nope: ? missing",
    ]);
    expect((await bind('select "Id", "id" from "Odd Name" t (renamed)')).names).toEqual([
      '"Odd Name": public.Odd Name',
      '"Id": ? missing',
      '"id": ? missing',
    ]);
    expect((await bind('select RENAMED, "Id" from "Odd Name" t')).names).toEqual([
      '"Odd Name": public.Odd Name',
      "RENAMED: ? missing",
      '"Id": public.Odd Name.Id',
    ]);
    expect((await bind("select x from unread_columns")).names).toEqual([
      "unread_columns: public.unread_columns",
      "x: ? unread",
    ]);
  });

  it("binds CTEs, recursive ones and their column lists", async () => {
    const sql =
      "with recursive t(n) as (select 1 union all select n + 1 from t where n < 3), u as (select n as m from t) select m, t.n, people.id from u, t, people";
    expect((await bind(sql)).names).toEqual([
      "t: cte t",
      "n: cte t.n",
      "n: cte t.n",
      "t: cte t",
      "n: cte t.n",
      "u: cte u",
      "t: cte t",
      "people: public.people",
      "m: cte u.m",
      "t: = cte t",
      "n: cte t.n",
      "people: = public.people",
      "id: public.people.id",
    ]);
    expect((await bind("with people as (select 1 as x) select x from people")).names).toEqual([
      "people: cte people",
      "x: cte people.x",
    ]);
    expect(
      (await bind("with a as (select * from b), b as (select 1) select * from a")).names,
    ).toEqual(["b: ? missing", "a: cte a"]);
  });

  it("binds subqueries in FROM, correlated subqueries and LATERAL", async () => {
    const sql =
      "select s.total, (select max(p.id) from people p where p.id = o.person) from orders o, (select total from orders) s where exists (select 1 from people where people.id = o.person)";
    const { names } = await bind(sql);
    expect(names).toContain("s: = (s)");
    expect(names).toContain("total: (s).total");
    expect(names.filter((n) => n.startsWith("o: "))).toEqual([
      "o: = public.orders",
      "o: = public.orders",
    ]);
    expect(names).toContain("max: ? unread");
    expect((await bind("select * from orders o, (select o.id) s")).names).toEqual([
      "orders: public.orders",
      "o: ? missing",
    ]);
    expect((await bind("select s.id from orders o, lateral (select o.id) s")).names).toEqual([
      "orders: public.orders",
      "o: = public.orders",
      "id: public.orders.id",
      "s: = (s)",
      "id: (s).id",
    ]);
    expect((await bind("select g.n from orders o, generate_series(1, o.id) g(n)")).names).toEqual(
      [
        "orders: public.orders",
        "generate_series: ? unread",
        "o: = public.orders",
        "id: public.orders.id",
        "g: = ?.generate_series()",
        "n: ?.generate_series().n",
      ].map((n) => n.replace("?.", "null.")),
    );
  });

  it("binds JOIN USING, NATURAL and join aliases", async () => {
    expect(
      (await bind("select id, person, p.name from people p join orders o using (id)")).unbound,
    ).toEqual([]);
    expect(
      (await bind("select x.id, x.total from people join orders using (id) as x")).names,
    ).toEqual([
      "people: public.people",
      "orders: public.orders",
      "x: = join x",
      "id: join x.id",
      "x: = join x",
      "total: ? missing",
    ]);
    expect(
      (
        await bind(
          "select j.name, people.name from (people join orders on people.id = orders.person) j",
        )
      ).names,
    ).toEqual([
      "people: public.people",
      "orders: public.orders",
      "people: = public.people",
      "id: public.people.id",
      "orders: = public.orders",
      "person: public.orders.person",
      "j: = join j",
      "name: public.people.name",
      "people: ? missing",
    ]);
    expect((await bind("select id from people natural join big_orders")).unbound).toEqual([]);
  });

  it("binds ORDER BY and GROUP BY to output names", async () => {
    const { names } = await bind(
      "select name as n, count(*) as c from people group by n order by c, n desc",
    );
    expect(names.slice(-3)).toEqual(["n: output n", "c: output c", "n: output n"]);
    expect((await bind("select id as name from people order by name")).names.at(-1)).toBe(
      "name: output name",
    );
    expect((await bind("select id as name from people group by name")).names.at(-1)).toBe(
      "name: public.people.name",
    );
    expect(
      (await bind("select id from people union select id from orders order by id")).names.at(-1),
    ).toBe("id: output id");
  });

  it("binds the targets of INSERT, UPDATE, DELETE and MERGE", async () => {
    expect((await bind("insert into orders (id, nope) select id, 1 from people")).names).toEqual([
      "orders: public.orders",
      "id: public.orders.id",
      "nope: ? missing",
      "people: public.people",
      "id: public.people.id",
    ]);
    expect(
      (await bind("update people p set name = o.total from orders o where o.person = p.id"))
        .unbound,
    ).toEqual([]);
    expect((await bind("update people p set nope = 1 where people.id = 1")).unbound).toEqual([
      "nope: ? missing",
      "people: ? missing",
    ]);
    expect(
      (await bind("delete from orders using people where people.id = orders.person and nope"))
        .unbound,
    ).toEqual(["nope: ? missing"]);
    const merge =
      "merge into people t using orders s on t.id = s.person when matched then update set name = s.total when not matched then insert (id, note) values (s.person, s.nope)";
    expect((await bind(merge)).unbound).toEqual(["nope: ? missing"]);
    expect((await bind("with orders as (select 1) delete from orders")).names).toEqual([
      "orders: public.orders",
    ]);
  });

  it("binds ON CONFLICT, excluded and RETURNING", async () => {
    const { names, unbound } = await bind(
      "insert into orders as o (id, total) values (1, 2) on conflict (id) do update set total = excluded.total + o.total where total > 0 returning id, old.total, new.total, excluded.id",
    );
    expect(unbound).toEqual(["excluded: ? missing"]);
    expect(names).toContain("excluded: = public.orders");
    expect(names.filter((n) => n.startsWith("total: "))).toEqual(
      Array(7).fill("total: public.orders.total"),
    );
    expect(
      (await bind("update orders set total = 0 returning with (old as was) was.total, old.total"))
        .unbound,
    ).toEqual(["old: ? missing"]);
    expect((await bind("delete from orders returning old.*, new.id")).unbound).toEqual([]);
    expect((await bind("select excluded.id from orders")).unbound).toEqual(["excluded: ? missing"]);
  });

  it("binds functions by name, schema and overloads", async () => {
    const { names, resolution } = await bind(
      "select add(1, 2), public.touch(), now(), app.nope(), later.f(), extract(year from now())",
    );
    expect(names).toEqual([
      "add: public.add()",
      "public: schema public",
      "touch: public.touch()",
      "now: ? unread",
      "app: schema app",
      "nope: ? missing",
      "later: schema later",
      "f: ? unread",
      "now: ? unread",
    ]);
    const add = resolution.names[0]?.target;
    expect(add?.kind === "function" && add.routines.map((r) => r.args)).toEqual([
      "a integer, b integer",
      "a numeric, b numeric",
    ]);
    expect((await bind("select now(), nope() from pg_tables", {}, CATALOG)).names).toEqual([
      "pg_tables: pg_catalog.pg_tables",
      "now: pg_catalog.now()",
      "nope: ? missing",
    ]);
  });

  it("lists every unbound name with its statement and position", async () => {
    const sql = "select nope from people;\nselect *\n  from ghost g where g.x = 'é'";
    const { resolution } = await bind(sql);
    expect(
      resolution.unbound.map(({ name, kind, statement, start, end, reason }) => ({
        name,
        kind,
        statement,
        start,
        end,
        reason,
      })),
    ).toEqual([
      {
        name: "nope",
        kind: "column",
        statement: 0,
        start: { byte: 7, offset: 7, line: 1, column: 8 },
        end: { byte: 11, offset: 11, line: 1, column: 12 },
        reason: "missing",
      },
      {
        name: "ghost",
        kind: "relation",
        statement: 1,
        start: { byte: 41, offset: 41, line: 3, column: 8 },
        end: { byte: 46, offset: 46, line: 3, column: 13 },
        reason: "missing",
      },
      expect.objectContaining({ name: "x", kind: "column", statement: 1, reason: "unread" }),
    ]);
  });

  it("binds names in definitions, not the names they create", async () => {
    expect(
      (await bind("create index on orders (person, (total * 2)) where nope > 0")).unbound,
    ).toEqual(["nope: ? missing"]);
    expect((await bind("create view v as select nope from people")).names).toEqual([
      "people: public.people",
      "nope: ? missing",
    ]);
    expect(
      (await bind("create table t (a int check (a > b), c int references people (id))")).names,
    ).toEqual(["a: null.t.a", "b: ? missing", "people: public.people"]);
    const trigger =
      "create trigger x before update on orders for each row when (old.total <> new.nope) execute function touch()";
    expect((await bind(trigger)).unbound).toEqual(["nope: ? missing"]);
    expect((await bind("create policy own on orders using (person = 1 and nope)")).unbound).toEqual(
      ["nope: ? missing"],
    );
    const body =
      "create function f(a int) returns int language sql begin atomic select a + id + nope from people; end";
    expect((await bind(body)).unbound).toEqual(["nope: ? missing"]);
    expect((await bind("alter table orders add check (total > nope)")).unbound).toEqual([
      "nope: ? missing",
    ]);
    expect((await bind("explain select nope from people")).unbound).toEqual(["nope: ? missing"]);
  });
});
