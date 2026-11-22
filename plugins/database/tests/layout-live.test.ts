// Format SQL against a real PostgreSQL (ADR 0292), when ENDUE_DB_TEST_POSTGRES holds a URI of a
// scratch database: the server's own parse tree of each statement (debug_print_parse) is the same
// for the statement as written and as Format lays it out, places in the text left out, in several
// styles. Each runs in a transaction that rolls back, over a schema of its own.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClients } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { createRunner } from "../ui/run.js";
import { fromValues } from "../ui/settings.js";
import { createLayout } from "../ui/sql/layout/layout.js";
import { createParse } from "../ui/sql/parse/parse.js";
import { createPositions } from "../ui/sql/parse/positions.js";
import { loadLibpgQuery } from "../ui/sql/parse/wasm.js";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";
import { STATEMENTS } from "./pg-corpus";
import { WASM } from "./pg-parser";

const uri = process.env.ENDUE_DB_TEST_POSTGRES;

function harness() {
  const { fields, password } = parseUri(uri ?? "");
  const conn = normalize({ ...fields, id: "c-layout-live", name: "layout live" });
  const bridge = nodeBridge();
  const runner = createRunner(bridge);
  const settings = fromValues({ "endue.database.max-rows": 1000 });
  const executor = createExecutor({
    runner,
    output: inProcessOutput(),
    clients: createClients(runner, () => settings),
    sessions: createSessions(bridge),
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message) => new Error(message),
  });
  return { run: (sql: string) => executor.execute(conn, sql, {}) };
}

const SETUP = [
  "drop schema if exists endue_layout cascade",
  "create schema endue_layout",
  "create table endue_layout.people (id int primary key, name text, note text)",
  "create table endue_layout.orders (id int primary key, person int, total numeric, at timestamptz)",
  "create table endue_layout.t (id int, a int, b int, c text, n int)",
].join(";\n");

/** Statements written by hand the way people type them, beside the corpus. */
const MESSY = [
  "select p.id,p.name , count(o.id) as orders,sum(o.total) total\nfrom people p left   join orders o on o.person=p.id and o.total>0\nwhere p.note is not null and (p.name like 'A%' or p.id between 1 and 10) group by p.id,p.name having count(o.id)>1 order by orders desc limit 10",
  "-- report\nselect id, -- the key\n  name /* who */, note\n  from people where id > 1 /* big */ and name is not null -- named\n order by id",
  "with recent as (select person, sum(total) as spent from orders where at >= date_trunc('year', now()) group by person) select p.id, case when r.spent > 1000 then 'gold' else 'standard' end as tier from people p join recent r on r.person = p.id where exists (select 1 from orders o where o.person = p.id and o.total > 0) order by r.spent desc",
  "update orders set total=total*1.1,at=now() where person in (select id from people where note='vip') returning id,total",
  "insert into people(id,name,note) values(1,'a',null),(2,'b','x') on conflict(id) do update set name=excluded.name",
  "create table endue_layout.made (id INTEGER primary key, at TIMESTAMP(3) WITH TIME ZONE not null, tags VARCHAR(20)[])",
];

/** Statements that change what the session or the server is, or wait on input, are not run. */
const NOT_RUN =
  /^(?:TransactionStmt|CopyStmt|LoadStmt|VariableSetStmt|DiscardStmt|CheckPointStmt|AlterSystemStmt|CreatedbStmt|DropdbStmt|CreateTableSpaceStmt|CreateSubscriptionStmt|VacuumStmt|ClusterStmt|ReindexStmt|ListenStmt|UnlistenStmt|NotifyStmt|CallStmt|DoStmt|ExecuteStmt|DeallocateStmt|FetchStmt|ClosePortalStmt)$/u;

const STYLES = [{}, { oneLine: "item", comma: "first", andOr: "after", keywordCase: "lower" }];

/** The server's parse tree of a statement, its places left out. */
async function treeOf(live: ReturnType<typeof harness>, sql: string) {
  const done = await live.run(
    `begin;\nset local search_path = endue_layout;\nset local client_min_messages = log;\nset local debug_print_parse = on;\n${sql};\nrollback`,
  );
  // The server's LOG comes as notices, a line each, with the statement that raised them (ADR 0334).
  const tree = (done.result.statements[4]?.notices ?? []).join("\n");
  if (!tree.includes("parse tree:")) return null;
  return tree.replace(/:(?:stmt_)?location -?\d+|:stmt_len \d+/gu, "").replace(/\s+/gu, " ");
}

describe.skipIf(!uri)("Format SQL against PostgreSQL", () => {
  let live: ReturnType<typeof harness>;

  beforeAll(async () => {
    live = harness();
    const done = await live.run(SETUP);
    expect(done.result.statements.map((s) => s.error?.message)).toEqual(
      SETUP.split(";\n").map(() => undefined),
    );
  }, 60_000);

  afterAll(async () => {
    await live.run("drop schema if exists endue_layout cascade");
  });

  it("the server reads each statement as Format lays it out to the same tree", async () => {
    const raw = await loadLibpgQuery(readFileSync(WASM));
    const layout = createLayout(raw);
    const parse = createParse(raw);
    const runnable = [...MESSY, ...STATEMENTS.map(([, sql]) => sql)].filter((sql) => {
      const [statement] = parse(sql, createPositions(sql)).statements;
      return statement && !NOT_RUN.test(statement.kind ?? "");
    });
    // The check sees a change: a different operator is a different tree, the same one written
    // over lines is not.
    const plus = await treeOf(live, "select 1 + 2");
    expect(plus).not.toBeNull();
    expect(await treeOf(live, "select 1 - 2")).not.toEqual(plus);
    expect(await treeOf(live, "SELECT\n    1\n    + 2")).toEqual(plus);
    let compared = 0;
    for (const sql of runnable) {
      const before = await treeOf(live, sql);
      if (before === null) continue;
      for (const style of STYLES) {
        const laid = layout(sql, style);
        expect([sql, laid.refused]).toEqual([sql, 0]);
        expect([sql, await treeOf(live, laid.text)]).toEqual([sql, before]);
      }
      compared++;
    }
    expect(compared).toBeGreaterThan(40);
  }, 300_000);
});
