// The parser and the resolver against a real PostgreSQL (ADR 0283), when ENDUE_DB_TEST_POSTGRES holds
// a URI of a scratch database: a statement that does not parse fails on the server with the same
// message at the same place, and the names the resolver lists as missing are the ones the server
// refuses, over a schema read with the plugin's own catalog.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCatalog } from "../ui/catalog.js";
import { createClients } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import { createExecutor } from "../ui/execute.js";
import { createRunner } from "../ui/run.js";
import { fromValues } from "../ui/settings.js";
import { modelOf, type SchemaModel } from "../ui/sql/parse/model.js";
import { resolve } from "../ui/sql/parse/resolve.js";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";
import { loadParse } from "./pg-parser";

const uri = process.env.ENDUE_DB_TEST_POSTGRES;

function harness() {
  const { fields, password } = parseUri(uri ?? "");
  const conn = normalize({ ...fields, id: "c-parse-live", name: "parse live" });
  const runner = createRunner(nodeBridge());
  const settings = fromValues({ "endue.database.max-rows": 1000 });
  const executor = createExecutor({
    runner,
    output: inProcessOutput(),
    clients: createClients(runner, () => settings),
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message) => new Error(message),
  });
  const execute = executor.execute.bind(executor);
  return { conn, execute, run: (sql: string) => execute(conn, sql, {}) };
}

const SETUP = [
  "drop schema if exists endue_parse cascade",
  "create schema endue_parse",
  "create table endue_parse.people (id int primary key, name text, note text)",
  "create table endue_parse.orders (id int primary key, person int references endue_parse.people (id), total numeric)",
  "create view endue_parse.big_orders as select id, total from endue_parse.orders where total > 100",
  "create function endue_parse.twice(x int) returns int language sql return x * 2",
].join(";\n");

/** Statements that do not parse, some over lines and with text past ASCII. */
const BROKEN = [
  "selec 1",
  "select 1 frm endue_parse.people",
  "select 'é', name\n  from endue_parse.people\n  wher id = 1",
  "create table t (a int,)",
  "insert into t values (1,, 2)",
  "select (1 + 2",
  "select 1 from t where",
  "update t set = 1",
  "select $$unterminated",
  "select 'unterminated",
  "select '😀 한', x\r\n  frm t",
];

/** [statement, the names the resolver lists unbound]: each refused by the server. */
const REFUSED: Array<[string, string[]]> = [
  ["select nope from endue_parse.people", ["nope"]],
  ["select p.nope from endue_parse.people p", ["nope"]],
  ["select * from endue_parse.ghost", ["ghost"]],
  ["select x.id from endue_parse.people p", ["x"]],
  ["select endue_parse.nope(1)", ["nope"]],
  ["select * from nowhere_parse.people", ["nowhere_parse", "people"]],
  ["select * from people", ["people"]],
  ["with t as (select 1 as a) select b from t", ["b"]],
  ["select id from endue_parse.people, endue_parse.orders", ["id"]],
  ["insert into endue_parse.orders (id, nope) values (1, 2)", ["nope"]],
  ["update endue_parse.people set nope = 1", ["nope"]],
  ["select * from endue_parse.orders o, (select o.id) s", ["o"]],
  ["select people.name from endue_parse.people p", ["people"]],
  ["select name from endue_parse.people order by nope", ["nope"]],
  ["select total from endue_parse.big_orders where name = 'x'", ["name"]],
];

/** Statements the server runs: the resolver lists nothing missing in them. */
const ACCEPTED = [
  "select p.name, count(o.id) as n from endue_parse.people p left join endue_parse.orders o on o.person = p.id group by p.name order by n desc",
  "with recursive t(n) as (select 1 union all select n + 1 from t where n < 3) select n from t",
  "select endue_parse.twice(id), b.total from endue_parse.big_orders b",
  "select * from endue_parse.people join endue_parse.orders using (id)",
  "insert into endue_parse.people (id, name) values (1, 'a') on conflict (id) do update set name = excluded.name returning id",
  "select s.n from endue_parse.people p, lateral (select p.id + 1 as n) s",
];

describe.skipIf(!uri)("the SQL parser against PostgreSQL", () => {
  let live: ReturnType<typeof harness>;
  let model: SchemaModel = { schemas: [] };
  let user = "";

  beforeAll(async () => {
    live = harness();
    const done = await live.run(SETUP);
    expect(done.result.statements.map((s) => s.error?.message)).toEqual(
      SETUP.split(";\n").map(() => undefined),
    );
    const who = await live.run("select current_user");
    user = who.result.statements[0]?.sets[0]?.rows[0]?.[0] ?? "";
    const catalog = createCatalog(live.execute, () => false);
    const schemas = await catalog.schemas(live.conn);
    const objects = new Map(
      await Promise.all(
        schemas.map(async (s) => [s, await catalog.objects(live.conn, s)] as const),
      ),
    );
    const columns = new Map<string, Array<{ name: string; type?: string }>>();
    for (const [schema, list] of objects)
      for (const o of list.filter((o) => o.kind === "table" || o.kind === "view"))
        columns.set(`${schema}.${o.name}`, await catalog.columns(live.conn, schema, o.name));
    model = modelOf({
      schemas,
      objects: (s) => objects.get(s),
      columns: (s, r) => columns.get(`${s}.${r}`),
    });
  }, 60_000);

  afterAll(async () => {
    await live.run("drop schema if exists endue_parse cascade");
  });

  it("a statement that does not parse fails on the server with the same message and place", async () => {
    const parse = await loadParse();
    const read = [];
    for (const sql of BROKEN) {
      const done = await live.run(sql);
      const server = done.result.statements[0]?.error;
      const [statement] = parse(sql).statements;
      read.push([sql, statement?.error?.message, statement?.error?.position.offset]);
      expect([sql, server?.kind]).toEqual([sql, "sql"]);
      expect([sql, server?.message, server?.position]).toEqual(read.at(-1));
    }
  }, 60_000);

  it("lists as missing the names the server refuses", async () => {
    const parse = await loadParse();
    for (const [sql, names] of REFUSED) {
      const done = await live.run(sql);
      const server = done.result.statements[0]?.error;
      expect([sql, server?.message]).toEqual([
        sql,
        expect.stringMatching(/does not exist|missing FROM-clause|invalid reference|ambiguous/u),
      ]);
      const { unbound } = resolve(sql, parse(sql), model, { user });
      expect([sql, unbound.map((n) => n.name)]).toEqual([sql, names]);
      // The server points at the reference: the first unbound name, or the qualifiers before it.
      const first = unbound[0];
      const at = server?.position ?? -1;
      expect([sql, at >= 0 && at <= (first?.start.offset ?? -1)]).toEqual([sql, true]);
      const before = sql.slice(at, first?.start.offset);
      expect([sql, before]).toEqual([sql, expect.stringMatching(/^(?:[a-z_]+\s*\.\s*)*$/u)]);
    }
  }, 60_000);

  it("lists nothing missing in statements the server runs", async () => {
    const parse = await loadParse();
    for (const sql of ACCEPTED) {
      const done = await live.run(`begin;\n${sql};\nrollback`);
      expect([sql, done.result.statements[1]?.error]).toEqual([sql, undefined]);
      const { unbound } = resolve(sql, parse(sql), model, { user });
      expect([sql, unbound.filter((n) => n.reason !== "unread").map((n) => n.name)]).toEqual([
        sql,
        [],
      ]);
    }
  }, 60_000);
});
