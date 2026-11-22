// The agents' tools and audit list against a real PostgreSQL, through the plugin's commands on the
// desk core's sessions (core-bridge.ts), no psql. It runs when ENDUE_DB_TEST_POSTGRES holds the URI
// of a scratch database it may write in: a schema of its own with one table (dropped after). An
// agent caller samples the table with a sensitive column masked, reads its statistics, the
// sessions list, a plan, a DDL and a check that prepares an INSERT without running it; a write
// handed to a read tool and a read that would write are refused by the server's read-only session;
// a write through the query is asked and runs; and the audit list holds every call.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import { MASK } from "../ui/features/audit/mask.js";
import { asAgent, auditOf } from "./audit-fixture";
import { serverSession } from "./core-bridge";
import { mount } from "./harness";
import { liveSessions } from "./live-sessions";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const SCHEMA = "audit_live";
const { admin } = liveSessions(uri, "audit");

const SETUP = [
  `CREATE SCHEMA ${SCHEMA}`,
  `CREATE TABLE ${SCHEMA}.people (id serial PRIMARY KEY, name text NOT NULL, email text)`,
  `INSERT INTO ${SCHEMA}.people (name, email) SELECT 'p' || g, 'p' || g || '@example.test' FROM generate_series(1, 50) g`,
  `ANALYZE ${SCHEMA}.people`,
];

async function plugin() {
  const { fields, password } = parseUri(uri);
  const conn = normalize({ ...fields, id: "c-live", name: "live" });
  const procs = realProcs(password ? { password } : {});
  const m = await mount({
    store: { connections: [conn] },
    handlers: procs.handlers,
    pick: () => "yes",
  });
  procs.attach((event) => m.host.emit(event));
  return m;
}

beforeAll(async () => {
  if (!uri) return;
  await admin(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  const own = await serverSession(uri, "audit setup", { lock_timeout: "30s" });
  try {
    await own.run(...SETUP);
  } finally {
    await own.close();
  }
}, 60_000);

afterAll(async () => {
  if (uri) await admin(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
});

describe.skipIf(!uri)("agents' tools on a real PostgreSQL", () => {
  it("read read-only and masked, refuse writes, and leave every call on the audit list", async () => {
    const m = await plugin();
    const table = { connection: "live", schema: SCHEMA, table: "people" };
    await m.host.command("endue.database.agent-access", {
      connection: "live",
      add: "people.email",
    });

    const sample = (await asAgent(m, "endue.database.sample-rows", { ...table, limit: 5 })) as {
      columns: string[];
      rows: string[][];
    };
    expect(sample.columns).toEqual(["id", "name", "email"]);
    expect(sample.rows).toHaveLength(5);
    expect(sample.rows.every((r) => r[2] === MASK)).toBe(true);

    const stats = (await asAgent(m, "endue.database.table-stats", table)) as {
      table: Record<string, string>;
      columns: Array<Record<string, string | null>>;
    };
    expect(Number(stats.table.estimated_rows)).toBe(50);
    const email = stats.columns.find((c) => c.attname === "email");
    expect(email?.histogram_bounds).toBe(MASK);
    expect(stats.columns.find((c) => c.attname === "name")?.histogram_bounds).toMatch(/^\{/u);

    const sessions = (await asAgent(m, "endue.database.sessions-list", { connection: "live" })) as {
      sessions: Array<Record<string, string>>;
    };
    expect(sessions.sessions.length).toBeGreaterThan(0);

    const plan = (await asAgent(m, "endue.database.explain-statement", {
      connection: "live",
      sql: `select * from ${SCHEMA}.people where id = 7`,
    })) as { plan: string };
    expect(plan.plan).toMatch(/Scan/u);

    const ddl = (await asAgent(m, "endue.database.object-ddl", {
      connection: "live",
      schema: SCHEMA,
      name: "people",
    })) as { ddl: string };
    expect(ddl.ddl).toMatch(/CREATE TABLE/u);

    const insert = `insert into ${SCHEMA}.people (name) values ('checked')`;
    expect(
      await asAgent(m, "endue.database.check-statement", { connection: "live", sql: insert }),
    ).toEqual({
      checked: true,
      ok: true,
      params: [],
      columns: [],
    });
    expect(
      await asAgent(m, "endue.database.check-statement", {
        connection: "live",
        sql: `select nosuch from ${SCHEMA}.people`,
      }),
    ).toMatchObject({ checked: true, ok: false, code: "42703", position: 7 });
    expect(await admin(`SELECT count(*) FROM ${SCHEMA}.people WHERE name = 'checked'`)).toBe("0");

    // A read that writes after all: the read-only session refuses it.
    const sneaky = (await asAgent(m, "endue.database.query", {
      connection: "live",
      sql: `select nextval('${SCHEMA}.people_id_seq')`,
    })) as { statements: Array<{ code?: string }> };
    expect(sneaky.statements[0]?.code).toBe("25006");
    // A filter on the sensitive column is refused; a write is asked and runs.
    const probe = (await asAgent(m, "endue.database.query", {
      connection: "live",
      sql: `select id from ${SCHEMA}.people where email like 'p1%'`,
    })) as { statements: Array<{ error?: string }> };
    expect(probe.statements[0]?.error).toMatch(/sensitive column email/u);
    await asAgent(m, "endue.database.query", { connection: "live", sql: insert });
    expect(m.picks.at(-1)?.title).toBe("Run this statement on live?");
    expect(await admin(`SELECT count(*) FROM ${SCHEMA}.people WHERE name = 'checked'`)).toBe("1");

    const list = auditOf(m, "c-live");
    expect(list.map((e) => [String(e.command).replace("endue.database.", ""), e.outcome])).toEqual([
      ["query", "ran"],
      ["query", "refused"],
      ["query", "failed"],
      ["check-statement", "failed"],
      ["check-statement", "ran"],
      ["object-ddl", "ran"],
      ["explain-statement", "ran"],
      ["sessions-list", "ran"],
      ["table-stats", "ran"],
      ["sample-rows", "ran"],
    ]);
    expect(list[0]).toMatchObject({
      caller: "agent:helper",
      statement: insert,
      rows: 1,
      asked: true,
      allowed: true,
    });
  }, 60_000);
});
