// PG-80 on a real PostgreSQL, when ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database whose
// role may create databases: once the caches of the connection's database and of a second database
// of the server are read, the palette's provider finds a table, a column, a function and a type of
// the first and a table of the second; after a restart it answers from the store before any session
// opens. Other runs use the same server at once, so only this run's second database is named and
// dropped. On the desk core's sessions (core-bridge.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import { serverSession } from "./core-bridge";
import { mount } from "./harness";
import { databaseOf } from "./live-sessions";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES;
const own = databaseOf(uri ?? "");
const second = `${own}_p490`;
const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;
const on = (database: string) => {
  const url = new URL(uri ?? "postgresql://localhost/x");
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
};
const admin = async (database: string, sql: string) => {
  const session = await serverSession(on(database), "endue tests t490");
  try {
    return await session.run(sql);
  } finally {
    await session.close();
  }
};
const DROPS = [
  "DROP TABLE IF EXISTS t490_orders",
  "DROP FUNCTION IF EXISTS t490_refund(int)",
  "DROP TYPE IF EXISTS t490_mood",
];
const CREATES = [
  "CREATE TABLE t490_orders (id int PRIMARY KEY, t490_customer_ref int)",
  "CREATE FUNCTION t490_refund(order_id int) RETURNS int LANGUAGE sql AS 'SELECT order_id'",
  "CREATE TYPE t490_mood AS ENUM ('ok', 'sad')",
];
type Result = { title: string; detail: string; kind: string };

describe.skipIf(!uri)("the palette finds the objects of a real server's caches", () => {
  beforeAll(async () => {
    await admin(own, `DROP DATABASE IF EXISTS ${quoted(second)} WITH (FORCE)`);
    await admin(own, `CREATE DATABASE ${quoted(second)}`);
    await admin(second, "CREATE TABLE t490_visits (id int PRIMARY KEY, page text NOT NULL)");
    for (const sql of [...DROPS, ...CREATES]) await admin(own, sql);
  }, 60_000);
  afterAll(async () => {
    await admin(own, `DROP DATABASE IF EXISTS ${quoted(second)} WITH (FORCE)`);
    for (const sql of DROPS) await admin(own, sql);
  }, 60_000);

  it("finds both databases' names, then answers from the store with no session", {
    timeout: 60_000,
  }, async () => {
    const { fields, password } = parseUri(uri ?? "");
    const conn = normalize({ ...fields, id: "c-t490", name: "Server" });
    const procs = realProcs(password ? { password } : {});
    const m = await mount({
      store: { connections: [conn] },
      handlers: procs.handlers,
      pick: () => "yes",
    });
    procs.attach((event) => m.host.emit(event));
    await m.host.command("endue.database.reload-schema", { connection: "Server" });
    await m.host.command("endue.database.reload-schema", { connection: `c-t490/${second}` });

    const find = async (host: typeof m.host, query: string) =>
      (
        (await host.command("endue.database.find-objects", { query, limit: 5 })) as {
          results: Result[];
        }
      ).results[0];
    expect(await find(m.host, "t490_orders")).toMatchObject({
      kind: "table",
      detail: "Table · public · Server",
    });
    expect(await find(m.host, "t490_customer_ref")).toMatchObject({ kind: "column" });
    expect(await find(m.host, "t490_refund")).toMatchObject({
      kind: "function",
      title: "t490_refund(order_id integer)",
    });
    expect(await find(m.host, "t490_mood")).toMatchObject({ kind: "type" });
    expect(await find(m.host, "t490_visits")).toMatchObject({
      detail: `Table · public · Server/${second}`,
    });

    const again = await mount({ store: { ...m.store }, handlers: procs.handlers });
    expect(await find(again.host, "t490_visits")).toMatchObject({ kind: "table" });
    expect(await find(again.host, "t490_orders")).toMatchObject({ kind: "table" });
    expect(again.host.calls.filter((c) => c.method === "db.open")).toEqual([]);
  });
});
