// The value search against a real PostgreSQL, through the plugin's commands on the desk core's
// sessions (core-bridge.ts), no psql. It runs when ENDUE_DB_TEST_POSTGRES holds the URI of a scratch
// database it may write in, for example postgresql://postgres:pw@db/scratch, as a superuser: a schema
// of its own with thirteen small tables of mixed column types (dropped after), one of them
// partitioned in two, a value found in four of them (a text, a jsonb document, a number, a row in
// each partition, searched once through the partitioned table), a regular expression ignoring case,
// a table left out by the size limit and found by its index when asked, each hit's filter finding its
// row on the server, and a role of this database's (dropped after) refused one table and slowed on
// another by a row-level policy that sleeps per row: that table passes a one-second statement
// timeout and is listed as skipped, and Cancel stops its statement on its session.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { SearchState } from "../ui/features/search/controller.js";
import { serverSession } from "./core-bridge";
import { type Mounted, mount } from "./harness";
import { databaseOf, liveSessions } from "./live-sessions";
import { runsOf } from "./runs-of";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const SCHEMA = "search_live";
// Other runs use the same server at once, each in a database of its own: the role is this
// database's, and only this database's sessions are looked up and ended.
const ROLE = `t491_reader_${databaseOf(uri)
  .toLowerCase()
  .replace(/[^a-z0-9_]/gu, "_")}`.slice(0, 63);
const PASSWORD = randomUUID();
const { admin } = liveSessions(uri, "search");

/** The statements that set the schema up, one by one on one session. */
const SETUP = `
CREATE SCHEMA ${SCHEMA};
SET search_path = ${SCHEMA};
CREATE TABLE accounts (id bigint PRIMARY KEY, balance numeric(12,2), opened date);
INSERT INTO accounts VALUES (1, 120.50, '2026-01-02'), (2, 98765.00, '2026-03-04');
CREATE TABLE audit (id bigint PRIMARY KEY, line text, data json);
INSERT INTO audit SELECT g, 'login', '{"who": "app"}' FROM generate_series(1, 10) g;
CREATE TABLE big (id bigint PRIMARY KEY, line text);
INSERT INTO big SELECT g, md5(g::text) FROM generate_series(1, 20000) g;
INSERT INTO big VALUES (987654, 'the value');
CREATE TABLE customers (id serial PRIMARY KEY, name text NOT NULL, code varchar(20), joined date);
INSERT INTO customers (name, code, joined) VALUES ('Ada', 'A-1', '2026-01-05'), ('Grace', '987654', '2026-02-11');
CREATE TABLE events (at timestamptz, payload jsonb);
INSERT INTO events VALUES (now(), '{"order": {"id": 987654}, "kind": "refund"}'), (now(), '{"order": 17, "note": "Order-17"}');
CREATE TABLE flags (active boolean, seen boolean);
INSERT INTO flags VALUES (true, false);
CREATE TABLE notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), body text);
INSERT INTO notes (body) VALUES ('ORDER-4242 shipped'), ('nothing here');
CREATE TABLE orders (id integer PRIMARY KEY, total numeric(10,2), ref uuid, placed timestamptz);
INSERT INTO orders VALUES (987654, 19.99, '7c9e6679-7425-40de-944b-e07fc1f90ae7', now()), (17, 5, gen_random_uuid(), now());
CREATE TABLE payments (id int PRIMARY KEY, amount numeric(10,2), memo varchar(200));
INSERT INTO payments VALUES (1, 98765.40, 'order-17 refund');
CREATE TABLE products (sku text PRIMARY KEY, title text, price numeric);
INSERT INTO products VALUES ('SKU-1', 'Blue mug', 12.5), ('SKU-2', 'Red mug', 9);
CREATE TABLE sessions (token uuid, seen timestamptz);
INSERT INTO sessions VALUES (gen_random_uuid(), now());
CREATE TABLE shipments (sent date, code text) PARTITION BY RANGE (sent);
CREATE TABLE shipments_2025 PARTITION OF shipments FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE shipments_2026 PARTITION OF shipments FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
INSERT INTO shipments VALUES ('2025-06-01', '987654'), ('2026-06-01', '987654'), ('2026-07-01', 'A-2');
CREATE TABLE tags (id int PRIMARY KEY, labels text[]);
INSERT INTO tags VALUES (1, ARRAY['987654']);
ANALYZE accounts, audit, big, customers, events, flags, notes, orders, payments, products, sessions, shipments, tags;
-- The role reads every table but customers, and audit only half a second a row.
CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}';
GRANT USAGE ON SCHEMA ${SCHEMA} TO ${ROLE};
GRANT SELECT ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${ROLE};
REVOKE SELECT ON customers FROM ${ROLE};
CREATE FUNCTION slowly(bigint) RETURNS boolean LANGUAGE sql VOLATILE AS 'SELECT $1 IS NOT NULL FROM pg_sleep(0.5)';
ALTER TABLE audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY slowly ON audit FOR SELECT TO ${ROLE} USING (slowly(id))
`
  .split(";\n")
  .map((sql) => sql.trim())
  .filter(Boolean);

/** The plugin with one connection to the scratch database, as the URI's role or `as`. */
async function plugin(as?: { user: string; password: string }) {
  const { fields, password } = parseUri(uri);
  const conn = normalize({
    ...fields,
    ...(as ? { user: as.user } : {}),
    id: "c-live",
    name: "live",
  });
  const secret = as?.password ?? password;
  // The password signs the session in as the person's typed one would, never through the store.
  const procs = realProcs(secret ? { password: secret } : {});
  const m = await mount({
    store: { connections: [conn] },
    handlers: procs.handlers,
    pick: () => "yes",
  });
  procs.attach((event) => m.host.emit(event));
  return m;
}

type Answer = {
  phase: string;
  searched: number;
  tables: {
    table: string;
    rowsBy: string[] | string;
    columns: { column: string; count: number }[];
  }[];
  skipped: { table: string; why: string }[];
};
const search = (m: Mounted, fields: Record<string, unknown>) =>
  m.host.command("endue.database.search-data", {
    connection: "live",
    schemas: [SCHEMA],
    ...fields,
  }) as Promise<Answer>;
const found = (a: Answer) =>
  a.tables.map((t) => [t.table.slice(SCHEMA.length + 1), t.columns.map((c) => c.column)]);
/** One of the plugin's actions, as the panel calls it. */
const act = (m: Mounted, name: string, ...args: unknown[]) => {
  const fn = (m.app as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name];
  if (!fn) throw new Error(`no action ${name}`);
  return fn(...args);
};
const panel = (m: Mounted) => m.shown()?.search as SearchState | undefined;
const active = async () =>
  Number(
    await admin(
      `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND query LIKE '%"${SCHEMA}"."audit"%' AND pid <> pg_backend_pid()`,
    ),
  );

/** End the role's sessions in this database, then drop what the test made. */
const clean = async () => {
  await admin(
    `SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = current_database() AND usename = '${ROLE}'`,
  );
  await admin(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  // The role's grants and its policy went with the schema.
  await admin(`DROP ROLE IF EXISTS ${ROLE}`);
};

beforeAll(async () => {
  if (!uri) return;
  await clean();
  const own = await serverSession(uri, "search setup", { lock_timeout: "30s" });
  try {
    await own.run(...SETUP);
  } finally {
    await own.close();
  }
}, 60_000);

afterAll(async () => {
  if (uri) await clean();
});

describe.skipIf(!uri)("the value search on a real PostgreSQL", () => {
  it("finds a value in four of thirteen tables (text, jsonb, a number, a partitioned table), by a regular expression, skips a table past its timeout and cancels mid-search", async () => {
    const m = await plugin();

    // A value equal to a text, to a number deep in a jsonb document, to an integer key and to a
    // text in both partitions of a partitioned table; the big table is left out by the size limit,
    // the one of booleans has nothing to look in.
    const equal = await search(m, { value: "987654", sizeLimit: 10_000 });
    expect(equal.phase).toBe("done");
    expect(found(equal)).toEqual([
      ["customers", ["code"]],
      ["events", ["payload"]],
      ["orders", ["id"]],
      ["shipments", ["code"]],
    ]);
    expect(equal.tables.map((t) => t.rowsBy)).toEqual([["id"], "ctid", ["id"], "ctid"]);
    expect(equal.skipped).toEqual([
      { table: `${SCHEMA}.big`, why: "over the size limit: about 20 thousand rows" },
    ]);
    expect(equal.searched).toBe(11);
    const run = panel(m)?.run;
    expect(run?.empty).toBe(1);
    // The partitioned table is searched once, for its partitions' rows; no partition on its own.
    expect(run?.total).toBe(13);
    const shipments = run?.tables[3]?.columns[0];
    expect(shipments?.count).toBe(2);
    expect(shipments?.hits.map((h) => h.key[1]).sort()).toEqual([
      `${SCHEMA}.shipments_2025`,
      `${SCHEMA}.shipments_2026`,
    ]);
    // So few rows are read in full; a number in the big table's key is found by its index.
    expect(run?.tables.map((t) => t.scan)).toEqual(["full", "full", "full", "full"]);

    // Each hit's filter finds its row on the table it is listed under: the key, else the ctid (and
    // the partition the row lives in).
    const id = m.shown()?.id as string;
    for (const [t, hit] of [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [3, 1],
    ] as const) {
      const { where } = (await act(m, "searchOpen", id, t, 0, hit)) as { where: string };
      const table = run?.tables[t]?.name;
      expect(await admin(`SELECT count(*) FROM ${SCHEMA}.${table} WHERE ${where}`), where).toBe(
        "1",
      );
      if (t === 2) expect(m.view.said.at(-1)).toBe("orders: the row of id 987654.");
    }
    expect(m.shown()?.table).toMatchObject({ schema: SCHEMA, name: "shipments" });

    // A regular expression ignoring case: a text, a varchar and a string inside a jsonb document.
    const regex = await search(m, { value: "^order-\\d+", match: "regex", ignoreCase: true });
    expect(found(regex)).toEqual([
      ["events", ["payload"]],
      ["notes", ["body"]],
      ["payments", ["memo"]],
    ]);
    // Contains finds a number inside a jsonb document, too.
    const inside = await search(m, {
      value: "8765",
      match: "contains",
      tables: "events, accounts",
    });
    expect(found(inside)).toEqual([
      ["accounts", ["balance"]],
      ["events", ["payload"]],
    ]);

    const keyed = await search(m, { value: "987654", types: ["number"], big: true, tables: "big" });
    expect(found(keyed)).toEqual([["big", ["id"]]]);
    expect(panel(m)?.run?.tables[0]?.scan).toBe("index");

    // As the role: customers refused, audit read half a second a row, so past a one-second
    // statement timeout; both skipped and said why, the rest searched.
    const reader = await plugin({ user: ROLE, password: PASSWORD });
    const refused = await search(reader, { value: "987654", timeoutSeconds: 1, sizeLimit: 10_000 });
    expect(refused.phase).toBe("done");
    expect(found(refused)).toEqual([
      ["events", ["payload"]],
      ["orders", ["id"]],
      ["shipments", ["code"]],
    ]);
    expect(refused.skipped).toEqual([
      { table: `${SCHEMA}.big`, why: "over the size limit: about 20 thousand rows" },
      { table: `${SCHEMA}.audit`, why: "past its timeout" },
      { table: `${SCHEMA}.customers`, why: "no permission to read it" },
    ]);

    // Cancel while audit is read: its statement stops on the server, no table after it is read.
    const panelId = reader.shown()?.id as string;
    const started = act(reader, "searchStart", panelId, {
      value: "987654",
      big: true,
      timeoutSeconds: 60,
    });
    for (let i = 0; i < 300 && panel(reader)?.run?.current !== `${SCHEMA}.audit`; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(panel(reader)?.run?.current).toBe(`${SCHEMA}.audit`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const asked = Date.now();
    await act(reader, "searchCancel", panelId);
    await started;
    const elapsed = Date.now() - asked;
    // The cancel went to the run in flight alone, on its own session.
    const calls = reader.host.calls as readonly {
      method: string;
      params?: Record<string, string>;
    }[];
    const audit = runsOf(calls)
      .filter((c) => c.method === "db.run" && c.params?.sql?.includes(`"${SCHEMA}"."audit"`))
      .at(-1);
    expect(calls.filter((c) => c.method === "db.cancel").map((c) => c.params?.sessionId)).toEqual([
      audit?.params?.sessionId,
    ]);
    const cancelled = panel(reader)?.run;
    expect(cancelled?.phase).toBe("cancelled");
    expect([cancelled?.done, cancelled?.total]).toEqual([2, 13]);
    expect(cancelled?.skipped.map((s) => [s.name, s.why])).toEqual([["audit", "cancelled"]]);
    expect(elapsed).toBeLessThan(1500);
    for (let i = 0; i < 50 && (await active()) > 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await active()).toBe(0);
    expect(reader.view.said.at(-1)).toBe(
      "No match; 1 table searched, cancelled after 2 of 13 tables.",
    );
  }, 60_000);
});
