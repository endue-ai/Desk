// PG-13 on a real PostgreSQL, when ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database whose
// role may create databases: one connection lists the server's databases, its own first; a second
// database's own table is read once its row opens, on sessions of that database; a database dropped
// after the list was read says so on its own row and nothing else changes; an agent's query runs on
// the second. Other runs use the same server at once, so only this run's databases are named and
// dropped. On the desk core's sessions (core-bridge.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { Node } from "../ui/explorer.js";
import { serverSession } from "./core-bridge";
import { type Mounted, mount } from "./harness";
import { databaseOf } from "./live-sessions";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES;
const own = databaseOf(uri ?? "");
const second = `${own}_b`;
const gone = `${own}_gone`;
const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;
/** The URI on another database of the server. */
const on = (database: string) => {
  const url = new URL(uri ?? "postgresql://localhost/x");
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
};
/** One statement as the URI's role, on a database. */
const admin = async (database: string, sql: string) => {
  const session = await serverSession(on(database), "endue tests t450");
  try {
    return await session.run(sql);
  } finally {
    await session.close();
  }
};

const tree = (m: Mounted) => m.view.trees.at(-1) ?? [];
const row = (m: Mounted, label: string, under?: Node) =>
  tree(m).find((r) => r.label === label && (!under || r.key.startsWith(`${under.key}\u0000`)));
async function until(test: () => unknown) {
  for (let i = 0; i < 200 && !test(); i++) await new Promise((r) => setTimeout(r, 25));
  expect(test()).toBeTruthy();
}
async function open(m: Mounted, ...labels: string[]) {
  let at: Node | undefined;
  for (const label of labels) {
    const under = at;
    await until(() => row(m, label, under));
    at = row(m, label, under) as Node;
    m.app.toggle(at, true);
  }
  return at as Node;
}

describe.skipIf(!uri)("one connection, every database of a real server", () => {
  beforeAll(async () => {
    for (const name of [second, gone])
      await admin(own, `DROP DATABASE IF EXISTS ${quoted(name)} WITH (FORCE)`);
    await admin(own, `CREATE DATABASE ${quoted(second)}`);
    await admin(own, `CREATE DATABASE ${quoted(gone)}`);
    await admin(second, "CREATE TABLE t450_visits (id int PRIMARY KEY, page text NOT NULL)");
  }, 60_000);
  afterAll(async () => {
    for (const name of [second, gone])
      await admin(own, `DROP DATABASE IF EXISTS ${quoted(name)} WITH (FORCE)`);
  }, 60_000);

  it("lists the databases, reads another one when it opens, and a gone one fails alone", {
    timeout: 60_000,
  }, async () => {
    const { fields, password } = parseUri(uri ?? "");
    const conn = normalize({ ...fields, id: "c-t450", name: "Server" });
    const procs = realProcs(password ? { password } : {});
    const m = await mount({
      store: { connections: [conn] },
      handlers: procs.handlers,
      pick: () => "yes",
    });
    procs.attach((event) => m.host.emit(event));

    const server = await open(m, "Server");
    await until(() => row(m, second, server) && row(m, gone, server));
    const databases = tree(m).filter((r) => r.kind === "database");
    expect(databases[0]).toMatchObject({ label: own, detail: "the connection's", expanded: true });
    expect(databases.map((r) => r.label)).toEqual(expect.arrayContaining([own, second, gone]));
    expect(databases.some((r) => r.label === "template0" || r.label === "template1")).toBe(false);
    await until(() => row(m, "public", row(m, own, server)));

    // The second database's own table, read on sessions of that database.
    const tables = await open(m, "Server", second, "public", "Tables");
    await until(() => row(m, "t450_visits", tables));
    expect(row(m, "t450_visits", tables)?.connection).toBe(`c-t450/${second}`);
    const opened = m.host.calls
      .filter((c) => c.method === "db.open")
      .map((c) => (c.params as { database: string }).database);
    expect(opened).toContain(second);
    expect(opened).not.toContain(gone);

    // Dropped after the list was read: its row says so, the others are as they were.
    await admin(own, `DROP DATABASE ${quoted(gone)} WITH (FORCE)`);
    const failed = await open(m, "Server", gone);
    await until(() => row(m, gone, server)?.error);
    const why = tree(m).find((r) => r.kind === "info" && r.key.startsWith(`${failed.key}\u0000`));
    expect(why?.label).toMatch(/does not exist/u);
    expect(row(m, "t450_visits", tables)).toBeDefined();
    expect(row(m, "public", row(m, own, server))).toBeDefined();

    const answer = (await m.host.invoke("endue.database.query", {
      connection: "Server",
      database: second,
      sql: "select current_database()",
    })) as { statements: { results?: { rows: string[][] }[] }[] };
    expect(answer.statements[0]?.results?.[0]?.rows).toEqual([[second]]);
  });
});
