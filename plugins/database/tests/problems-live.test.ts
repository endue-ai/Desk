// The SQL problems against a real PostgreSQL (PG-30, ADR 0294), when ENDUE_DB_TEST_POSTGRES holds the
// URI of a scratch database: the plugin's schema cache reads a schema with a partitioned table whose
// partitions are named otherwise (one in the other schema), a sequence and a view; then every
// statement of a corpus is checked
// over what the cache holds and run by the server in a transaction that is never kept. A statement
// the server runs reports nothing; one it refuses that the check tells reports the server's message
// where the server points.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClients } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import { problemModel } from "../ui/diagnose/model.js";
import { createExecutor } from "../ui/execute.js";
import { createRunner } from "../ui/run.js";
import { createSchemaCache } from "../ui/schema-cache/index.js";
import { fromValues } from "../ui/settings.js";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";
import { checker } from "./problems-fixture";
import { memoryStore } from "./schema-cache-helpers";

const pgUri = process.env.ENDUE_DB_TEST_POSTGRES;
const S = "t460_live";
/** A schema with a partitioned table, whose partitions the cache reads under it (PG-50). */
const P = "t460_parts";

/** Statements the server runs: nothing may be reported. */
const RUNS = [
  "select id, name, email from people",
  "select p.id, o.total from people p join orders o on o.person = p.id where o.total > 1",
  `select * from ${P}.ev_2024, ${P}.events where events.at > '2024-02-01'`,
  `select id from ${P}.ev_2024 where at is not null`,
  "select at from ev_2025 where id > 0",
  "select ctid, xmin, tableoid from people",
  "select last_value from people_id_seq",
  "select id from big_orders",
  "select gen_random_uuid(), count(*), now() from people",
  "select id as d from people order by d",
  "select name, count(*) from people group by 1",
  "insert into people values (100)",
  "insert into people (id, name) values (101, 'a'), (102, default)",
  "insert into people (id) select 103",
  "update people set name = 'x' where id = 1 returning *",
  "delete from orders using people where orders.person = people.id and people.id = -1",
  "with t as (select person, count(*) c from orders group by person) select t.c, people.name from people join t on t.person = people.id",
  "select (select max(total) from orders o where o.person = p.id) from people p",
  "select * from people p, lateral (select total from orders where person = p.id) x",
  "alter table if exists ghost add column x int",
  "create table made (a int);\nselect a from made",
  "create temp table tt (b int);\nselect b from tt",
  "set search_path to pg_catalog;\nselect relname from pg_class limit 1",
  `select * from ${S}.people`,
  "create index on people (name)",
  "comment on column people.name is 'Full name'",
  "alter table people add column age int;\nselect age from people",
  "alter table people rename column name to full_name;\nselect full_name from people",
  "alter table people rename to persons;\nselect * from persons",
  "create view v as select id, email from people;\nselect email from v",
  "create schema t460_more;\ncreate table t460_more.t (a int);\nselect a from t460_more.t",
  "do $$ begin execute 'create table made_inside (z int)'; end $$;\nselect z from made_inside",
  "truncate orders",
  "drop table if exists ghost",
  "insert into orders (id, person, total) values (1, 1, 2) on conflict (id) do update set total = excluded.total",
  "update orders o set total = p.id from people p where p.id = o.person",
  "select count(*) filter (where total > 1) from orders",
  "select o.* from orders o where exists (select 1 from people p where p.id = o.person)",
  "select * from pg_catalog.pg_class limit 1",
  "select * from information_schema.tables limit 1",
];

/** Statements the server refuses that the check tells: the server's message, where it points. */
const CAUGHT = [
  "selec 1",
  "select 1 frm people",
  "select (1 + 2",
  "select emial from people",
  "select p.emial from people p",
  "select * from peple",
  "select * from nosuch.people",
  `select * from ${S}.ghost`,
  "select nosuch.f(1)",
  "select id from people, orders",
  "select x.id from people p",
  "select * from people a join orders b on b.person = c.id join people c on c.id = a.id",
  "select id * 2 as d, d + 1 from people",
  "select id as d from people where d > 1",
  "insert into people (id, name) values (1)",
  "insert into people (id) values (1, 2)",
  "insert into people values (1, 'a', 'b', 'c')",
  "insert into people (id, name) select 1",
  "insert into people (id, nope) values (1, 2)",
  "update people set nope = 1",
  "select * from people where id = 1 and emial = 'x'",
  "select people.id from people p",
  "insert into people (id, name) values (1, 'a'), (2)",
  "alter table ghost add column x int",
  "create index on ghost (a)",
  "with t as (select 1 a) select b from t",
  "select o.nope from orders o join people p on p.id = o.person",
  "delete from peple",
  "update orders set total = 1 where persn = 1",
  "select emial from (select email from people) s",
  "select * from big_orders where totl > 1",
  "create table made (a int);\nselect b from made",
  `select * from ${P}.ev_2023`,
  `select nope from ${P}.ev_2024`,
];

/** Statements the server refuses where the check cannot tell: a schema the cache did not read. */
const UNTOLD = [
  "set search_path to public;\nselect * from t460_ghost",
  "select * from public.t460_ghost",
];

describe.skipIf(!pgUri)("SQL problems on a real PostgreSQL", () => {
  const { fields, password } = parseUri(pgUri ?? "postgres://");
  const conn = normalize({ ...fields, id: "c-live-460", name: "live" });
  const runner = createRunner(nodeBridge());
  const settings = fromValues({});
  const executor = createExecutor({
    runner,
    output: inProcessOutput(),
    clients: createClients(runner, () => settings),
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message) => new Error(message),
  });
  const run = async (sql: string) => {
    const done = await executor.execute(conn, sql);
    const failed = done.result.error ?? done.result.statements.find((s) => s.error)?.error;
    if (failed) throw new Error(failed.message);
  };
  /** The script in a transaction never kept (the client ends inside it), under the schema: the
   * first statement refused, if any. */
  const BEFORE = `BEGIN;\nSET LOCAL search_path TO ${S};\n`;
  const refusal = async (sql: string) => {
    const done = await executor.execute(conn, `${BEFORE}${sql}`);
    const statements = done.result.statements;
    const index = statements.findIndex((s) => s.error);
    if (done.result.error) throw new Error(done.result.error.message);
    if (index < 0) return null;
    const error = statements[index]?.error;
    const piece = done.statements[index];
    return {
      message: error?.message ?? "",
      at:
        error?.position === undefined
          ? undefined
          : (piece?.start ?? 0) - BEFORE.length + error.position,
    };
  };
  const cache = createSchemaCache({
    execute: (c, sql, options) => executor.execute(c, sql, options),
    store: memoryStore(),
    systemSchemas: () => false,
    changed: () => {},
  });

  beforeAll(async () => {
    await run(`DROP SCHEMA IF EXISTS ${S}, ${P} CASCADE`);
    await run(
      `CREATE SCHEMA ${S};\nCREATE SCHEMA ${P};\nSET search_path TO ${S};\n` +
        "CREATE TABLE people (id int PRIMARY KEY, name text, email text);\n" +
        "CREATE TABLE orders (id int PRIMARY KEY, person int, total numeric);\n" +
        "CREATE VIEW big_orders AS SELECT id, total FROM orders WHERE total > 100;\n" +
        `CREATE TABLE ${P}.events (id int, at date) PARTITION BY RANGE (at);\n` +
        `CREATE TABLE ${P}.ev_2024 PARTITION OF ${P}.events FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');\n` +
        `CREATE TABLE ev_2025 PARTITION OF ${P}.events FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');\n` +
        "CREATE SEQUENCE people_id_seq",
    );
  }, 60_000);
  afterAll(async () => {
    await run(`DROP SCHEMA IF EXISTS ${S}, ${P} CASCADE`);
  }, 60_000);

  it("every reported problem is where the server refuses the statement, and what the server runs reports nothing", async () => {
    await cache.open(conn);
    await cache.choose(conn, [S, P]);
    await cache.settled(conn);
    const model = problemModel(conn.id, cache.view(conn) as never);
    expect(
      model?.schemas
        .find((s) => s.name === S)
        ?.relations?.map((r) => r.name)
        .sort(),
    ).toEqual(["big_orders", "ev_2025", "orders", "people", "people_id_seq"]);
    expect(model?.schemas.find((s) => s.name === P)?.relations?.map((r) => r.name)).toEqual([
      "events",
      "ev_2024",
    ]);
    const c = await checker();
    const check = (sql: string) => c.check({ sql, searchPath: [S], user: "" }, model).problems;
    for (const sql of RUNS) {
      const refused = await refusal(sql);
      const found = check(sql);
      expect([sql, refused]).toEqual([sql, null]);
      expect([sql, found]).toEqual([sql, []]);
    }
    for (const sql of CAUGHT) {
      const refused = await refusal(sql);
      const found = check(sql);
      expect([sql, refused === null]).toEqual([sql, false]);
      expect([sql, found.length]).toEqual([sql, 1]);
      const [first] = found;
      expect([sql, first?.message.split("\n")[0]?.startsWith(refused?.message ?? "?")]).toEqual([
        sql,
        true,
      ]);
      if (refused?.at !== undefined) expect([sql, first?.from]).toEqual([sql, refused.at]);
    }
    for (const sql of UNTOLD) {
      expect([sql, (await refusal(sql)) === null]).toEqual([sql, false]);
      expect([sql, check(sql)]).toEqual([sql, []]);
    }
  }, 120_000);
});
