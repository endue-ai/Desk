// The SQL warnings the editor marks (PG-36, ADR 0328), as the parse worker's check finds them beside
// the problems: statements the server runs that are likely mistakes, each with its identifier and a
// one-line reason, a fix only where the rewrite cannot change more than the warning says, and a
// setting or a comment that turns them off. Each fires on its case and stays silent on its near miss.
import { describe, expect, it } from "vitest";
import { checker } from "./problems-fixture";
import { fixed, WARN_MODEL, warned, warningsIn } from "./warnings-fixture";

/** Each identifier: statements it fires on (with the text it underlines), and near misses. */
const CASES: Array<[string, Array<[string, string]>, string[]]> = [
  [
    "null-comparison",
    [
      ["select * from people where name = null", "= null"],
      ["select * from people where name <> NULL", "<> NULL"],
      ["select * from people where name != null", "!= null"],
      ["select * from people where NULL = name", "NULL = name"],
      ["select case name when null then 1 end from people", "null"],
    ],
    [
      "select * from people where name is null",
      "update people set name = null where id = 1",
      "select * from people where name = 'null'",
      "select * from people where name is not distinct from null",
    ],
  ],
  [
    "join-without-condition",
    [
      ["select * from people, orders", "orders"],
      ["select * from people p, orders o where p.id = 1", "orders"],
      ["select * from people join orders on true", "true"],
      ["select * from people p join orders o on 1 = 1", "1 = 1"],
      ["select * from people natural join tags", "tags"],
      ["update orders set total = 0 from people", "people"],
      ["delete from orders using people", "people"],
    ],
    [
      "select * from people p, orders o where o.person = p.id",
      "select * from people, orders where person = manager",
      "select * from people cross join orders",
      "select * from people p left join lateral (select 1) x on true",
      "select * from people natural join orders",
      "select * from people, generate_series(1, 3) g",
      "with c as (select 1 a) select * from people, c",
      "select * from people p, orders o where exists (select 1 from tags where tags.label = p.name and o.id > 0)",
      "update orders set total = 0 from people where people.id = orders.person",
      "select * from people p join orders o on o.person = p.id",
    ],
  ],
  [
    "select-star",
    [
      ["create view v as select * from people", "*"],
      ["create view v as select p.* from people p", "p.*"],
      ["create materialized view m as select * from people", "*"],
      ["create view v as select id from people union select * from orders", "*"],
      ["insert into tags (label) select * from tags", "*"],
    ],
    [
      "select * from people",
      "create view v as select id from people where exists (select * from orders)",
      "create table c as select * from people",
      "create view v as select count(*) from people",
      "insert into tags (label) select label from tags",
    ],
  ],
  [
    "column-cast",
    [
      ["select * from people where id = 1.5", "id"],
      ["select * from people where id in (1, 2.5)", "id"],
      ["select * from people where id between 1 and 2.5", "id"],
      ["select * from people where code = 'abc'::text", "code"],
      ["select * from people where code = 'abc'::varchar", "code"],
      ["select * from orders where total = 1.5::float8", "total"],
      ["select * from orders where person < weight", "person"],
      ["select * from people p join orders o on o.total = p.id", "p.id"],
    ],
    [
      "select * from orders where total = 1",
      "select * from people where id = 1",
      "select * from people where email = 'x'::text",
      "select * from people where id = '1.5'",
      "select id = 1.5 from people",
      "select * from orders where weight = 1.5",
      "select * from people where joined = now()",
      "select * from people where code = 'abc'",
    ],
  ],
  [
    "not-in-null",
    [
      ["select * from people where id not in (select person from orders)", "not in"],
      ["select * from people where id not in (1, null)", "not in"],
    ],
    [
      "select * from people where manager not in (select id from orders)",
      "select * from people where id in (select person from orders)",
      "select * from people where id not in (select person from orders where person is not null)",
      "select * from people where id not in (1, 2)",
      "select * from people where id in (1, null)",
    ],
  ],
  [
    "update-without-where",
    [
      ["update people set name = 'x'", "people"],
      ["update public.people p set name = 'x' from orders", "public.people"],
    ],
    [
      "update people set name = 'x' where id = 1",
      "update people set name = 'x' where current of c",
    ],
  ],
  [
    "delete-without-where",
    [
      ["delete from people", "people"],
      ["with gone as (delete from orders returning person) select * from gone", "orders"],
    ],
    [
      "delete from people where current of c",
      "delete from orders using people where orders.person = people.id",
      "truncate people",
    ],
  ],
  [
    "limit-without-order",
    [
      ["select * from people limit 5", "limit 5"],
      ["select * from people offset 10", "offset 10"],
      ["select * from people fetch first 3 rows only", "fetch first 3"],
      ["select id from people union select id from orders limit 2", "limit 2"],
      ["select * from (select * from people limit 1) s order by id", "limit 1"],
    ],
    [
      "select * from people order by id limit 5",
      "select * from people limit all",
      "select 1 limit 1",
      "select * from people where exists (select 1 from orders limit 1)",
      "select id from people union select id from orders order by 1 limit 2",
    ],
  ],
  [
    "function-on-indexed-column",
    [
      ["select * from people where lower(email) = 'a@b'", "lower(email)"],
      [
        "select * from people where date_trunc('month', joined) = '2024-01-01'",
        "date_trunc('month', joined)",
      ],
      ["select * from people p where upper(p.email) like 'A%'", "upper(p.email)"],
      ["select * from orders o join people p on abs(o.person) = p.id", "abs(o.person)"],
    ],
    [
      "select * from people where lower(name) = 'x'",
      "select * from people where email = 'a@b'",
      "select * from orders where abs(total) > 1",
      "select lower(email) from people",
      "select * from people where lower(email) is null",
      "select * from people where email = lower('A@B')",
    ],
  ],
  [
    "insert-without-columns",
    [
      ["insert into people values (1, 'a')", "people"],
      ["insert into people as p values (1)", "people as p"],
      ["insert into ghost values (1)", "ghost"],
      ["insert into tags select label from tags", "tags"],
    ],
    [
      "insert into people (id) values (1)",
      "insert into people default values",
      "insert into people (id, name) select 1, 'a'",
    ],
  ],
  [
    "server-signal",
    [
      [
        "select pg_terminate_backend(pid) from pg_stat_activity where usename = 'x'",
        "pg_terminate_backend",
      ],
      ["select pg_catalog.pg_cancel_backend(42)", "pg_catalog.pg_cancel_backend"],
    ],
    ["select 'pg_cancel_backend(1)'", "select pg_backend_pid()"],
  ],
];

describe("SQL warnings", () => {
  for (const [rule, fires, misses] of CASES)
    it(`${rule} fires on its case and stays silent on its near miss`, async () => {
      for (const [sql, text] of fires)
        expect([sql, (await warned(sql)).filter(([, r]) => r === rule)]).toEqual([
          sql,
          [[text, rule]],
        ]);
      for (const sql of misses)
        expect([sql, (await warned(sql)).filter(([, r]) => r === rule)]).toEqual([sql, []]);
    });

  it("each warning has a one-line reason in the server's terms", async () => {
    const said = async (sql: string) => (await warningsIn(sql)).map((w) => w.message);
    expect(await said("select * from people where name = null")).toEqual([
      "= NULL is never true, not even when the value is NULL: IS NULL tests for it.",
    ]);
    expect(await said("select * from people where name <> null")).toEqual([
      "<> NULL is never true, whatever the value: IS NOT NULL tests for it.",
    ]);
    expect(await said("select * from people, orders")).toEqual([
      "Nothing links orders to people: every row of one pairs with every row of the other.",
    ]);
    expect(await said("select * from people where id = 1.5")).toEqual([
      "id is integer and is compared with a numeric value: the server casts id to numeric, so an index on id cannot be used.",
    ]);
    expect(await said("select * from people where id not in (select person from orders)")).toEqual([
      "NOT IN is never true once its subquery returns a NULL, and orders.person can be NULL: NOT EXISTS has no such trap.",
    ]);
    expect(await said("update people set name = 'x'")).toEqual([
      "UPDATE without WHERE changes every row of people.",
    ]);
    expect(await said("select * from people where lower(email) = 'a'")).toEqual([
      "lower() over email keeps the server from using the index people_email: compare email itself, or index the expression.",
    ]);
    expect(await said("select pg_terminate_backend(1)")).toEqual([
      "pg_terminate_backend ends a server session and rolls back its open transaction: a read-only connection refuses it, and production and agents ask first.",
    ]);
    for (const [, fires] of CASES)
      for (const [sql] of fires)
        for (const message of await said(sql)) expect(message, sql).not.toMatch(/\n/u);
  });

  it("a fix is offered only where the rewrite is certain", async () => {
    expect(await fixed("select * from people where name = null")).toBe(
      "select * from people where name is null",
    );
    expect(await fixed("select * from people where name <> NULL and id > 1")).toBe(
      "select * from people where name IS NOT NULL and id > 1",
    );
    expect(await fixed("select * from people where name != null")).toBe(
      "select * from people where name is not null",
    );
    expect(await fixed("select * from people where NULL = p.name")).toBe(
      "select * from people where p.name IS NULL",
    );
    expect(await fixed("select * from people where NULL = lower(name)")).toBeNull();
    expect(await fixed("select case name when null then 1 end from people")).toBeNull();
    // The column list: as many of the cached columns as the statement has values, quoted as needed.
    expect(await fixed("insert into people values (1, 'a')")).toBe(
      "insert into people (id, name) values (1, 'a')",
    );
    expect(await fixed("insert into people as p values (1)")).toBe(
      "insert into people as p (id) values (1)",
    );
    expect(await fixed("insert into people select 1, 'a', 'b'")).toBe(
      "insert into people (id, name, email) select 1, 'a', 'b'",
    );
    expect(await fixed("insert into odd values (1, 'a', 'b')")).toBe(
      "insert into odd (\"Order\", \"user\", plain) values (1, 'a', 'b')",
    );
    // Unknown columns, a SELECT *, more values than columns: no fix.
    expect(await fixed("insert into ghost values (1)")).toBeNull();
    expect(await fixed("insert into people values (1)", null)).toBeNull();
    expect(
      (await warningsIn("insert into tags select * from tags")).map((w) => [w.rule, w.fix]),
    ).toEqual([
      ["insert-without-columns", undefined],
      ["select-star", undefined],
    ]);
    expect(await fixed("create table made (a int, b int);\ninsert into made values (1)")).toBe(
      "create table made (a int, b int);\ninsert into made (a) values (1)",
    );
    // Every other warning has none.
    for (const sql of [
      "select * from people, orders",
      "update people set name = 'x'",
      "select * from people limit 5",
      "select * from people where id = 1.5",
    ])
      expect([sql, await fixed(sql)]).toEqual([sql, null]);
  });

  it("a setting or a comment turns warnings off, never the errors", async () => {
    const sql = "select * from people where name = null limit 5";
    expect(await warned(sql)).toEqual([
      ["= null", "null-comparison"],
      ["limit 5", "limit-without-order"],
    ]);
    expect(await warned(sql, { warnings: false })).toEqual([]);
    expect(await warned(sql, { off: ["limit-without-order"] })).toEqual([
      ["= null", "null-comparison"],
    ]);
    // After code a comment covers its own line; alone on its line, the next one.
    expect(await warned(`${sql} -- endue-ignore limit-without-order`)).toEqual([
      ["= null", "null-comparison"],
    ]);
    expect(await warned(`-- endue-ignore\n${sql}`)).toEqual([]);
    expect(await warned(`-- endue-ignore: null-comparison, limit-without-order\n${sql}`)).toEqual(
      [],
    );
    expect(await warned(`/* endue-ignore null-comparison */ ${sql}`)).toEqual([
      ["limit 5", "limit-without-order"],
    ]);
    expect(await warned(`-- endue-ignore\n\n${sql}`)).toHaveLength(2);
    expect(await warned(`select 'endue-ignore', * from people limit 5`)).toHaveLength(1);
    // After the statement's end, on the same line, at the end of the script.
    expect(await warned("delete from people; -- endue-ignore delete-without-where")).toEqual([]);
    expect(await warned("delete from people; -- endue-ignore\nupdate people set id = 1")).toEqual([
      ["people", "update-without-where"],
    ]);
    // Errors stay.
    const c = await checker();
    const both = c.check(
      { sql: "select emial from people limit 1 -- endue-ignore", warnings: true },
      WARN_MODEL,
    ).problems;
    expect(both.map((p) => p.kind)).toEqual(["names"]);
    // A statement that ran keeps its warnings; the server's answer replaces only the errors.
    const ran = c.check(
      { sql, warnings: true, answers: [[sql, { ok: true }]] },
      WARN_MODEL,
    ).problems;
    expect(ran.map((p) => p.kind)).toEqual(["warning", "warning"]);
  });

  it("warnings need no schema where they read only the statement", async () => {
    expect(
      (
        await warned(
          "select * from people where name = null limit 1;\ndelete from people",
          {},
          null,
        )
      ).map(([, rule]) => rule),
    ).toEqual(["null-comparison", "limit-without-order", "delete-without-where"]);
    // What needs the schema says nothing without it.
    expect(await warned("select * from people where id = 1.5", {}, null)).toEqual([]);
    expect(await warned("select * from people where lower(email) = 'a'", {}, null)).toEqual([]);
    // After DO the schema is unknown: only what the statement alone shows.
    expect(
      await warned("do $$ begin end $$;\nselect * from people where id = 1.5 and name = null"),
    ).toEqual([["= null", "null-comparison"]]);
  });

  it("1 MB of SQL is checked with its warnings within the problems' budget", async () => {
    const unit = (n: number) =>
      [
        `select p.id, p.name from people p join orders o on o.person = p.id where p.email = 'x' and o.total > ${n} order by p.id limit 10`,
        `select * from people where name = null and id not in (select person from orders) limit ${n}`,
        `update people set name = 'x' where lower(email) = 'a' and id = 1.5`,
        `insert into people values (${n}, 'a')`,
      ].join(";\n");
    let script = "";
    for (let n = 0; script.length < 1024 * 1024; n++) script += `${unit(n)};\n`;
    const c = await checker();
    const first: number[] = [];
    const again: number[] = [];
    for (let run = 0; run < 3; run++) {
      const doc = `big-${run}`;
      let at = performance.now();
      const done = c.check({ sql: script, doc, warnings: true }, WARN_MODEL);
      first.push(performance.now() - at);
      expect(done.problems.length).toBeGreaterThan(100);
      const edited = script.replace("o.total > 7 ", "o.totl > 7 ");
      at = performance.now();
      const next = c.check({ sql: edited, doc, warnings: true }, WARN_MODEL);
      again.push(performance.now() - at);
      expect(next.parsed).toBe(1);
    }
    const best = { first: Math.min(...first), again: Math.min(...again) };
    console.log(`warnings, 1 MB: ${JSON.stringify(best)}`);
    expect(best.first).toBeLessThan(2000);
    expect(best.again).toBeLessThan(300);
  }, 60_000);
});
