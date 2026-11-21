// The value search against a real PostgreSQL, through the plugin's commands and the real psql. It
// runs when ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database it may write in, for example
// postgresql://postgres:pw@db/scratch: a schema of its own with twelve tables of mixed column types
// (dropped after), a value found in three of them (a text, a jsonb document, a number), a regular
// expression ignoring case, a big table left out by its size, then searched with a one-second
// statement timeout and listed as skipped, Cancel while the big table is read, a role of its own
// (dropped after) refused one table, and each hit's filter finding its row on the server.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { SearchState } from "../ui/features/search/controller.js";
import { type Handlers, type Mounted, mount } from "./harness";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const SCHEMA = "search_live";
const ROLE = "t491_reader";
/** A regular expression the server reads slowly: about two seconds on the big table. */
const SLOW = "(.*a.*b.*c.*d.*)z";

/** psql on the scratch database as the URI's role, unaligned, for what the test sets up. */
const admin = (sql: string) => {
  const done = spawnSync(
    "psql",
    ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", uri, "-c", sql],
    {
      encoding: "utf8",
    },
  );
  if (done.status !== 0) throw new Error(done.stderr);
  return done.stdout.trim();
};

const SETUP = `
CREATE SCHEMA ${SCHEMA};
SET search_path = ${SCHEMA};
CREATE TABLE accounts (id bigint PRIMARY KEY, balance numeric(12,2), opened date);
INSERT INTO accounts VALUES (1, 120.50, '2026-01-02'), (2, 98765.00, '2026-03-04');
CREATE TABLE audit (id bigint PRIMARY KEY, line text, data json);
INSERT INTO audit VALUES (1, 'login', '{"who": "app"}');
CREATE TABLE big (id bigint PRIMARY KEY, line text);
INSERT INTO big SELECT g, repeat(md5(g::text), 8) FROM generate_series(1, 1500000) g;
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
CREATE TABLE tags (id int PRIMARY KEY, labels text[]);
INSERT INTO tags VALUES (1, ARRAY['987654']);
ANALYZE accounts, audit, big, customers, events, flags, notes, orders, payments, products, sessions, tags;
`;

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
  const procs = realProcs();
  const spawnReal = procs.handlers["proc.spawn"] as unknown as (
    params: Record<string, unknown>,
    caller?: string,
  ) => unknown;
  const handlers = {
    ...procs.handlers,
    // The password reaches psql as the person's typed one would, never through the store.
    "proc.spawn": (params: Record<string, unknown>, caller?: string) =>
      spawnReal(
        {
          ...params,
          env: { ...(params.env as object), ...(secret ? { PGPASSWORD: secret } : {}) },
        },
        caller,
      ),
  } as unknown as Handlers;
  const m = await mount({ store: { connections: [conn] }, handlers, pick: () => "yes" });
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
const active = () =>
  Number(
    admin(
      `SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND query LIKE '%"${SCHEMA}"."big"%' AND pid <> pg_backend_pid()`,
    ),
  );

beforeAll(() => {
  if (!uri) return;
  admin(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  admin(SETUP);
}, 120_000);

afterAll(() => {
  if (!uri) return;
  admin(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  // The role's grants went with the schema.
  admin(`DROP ROLE IF EXISTS ${ROLE}`);
});

describe.skipIf(!uri)("the value search on a real PostgreSQL", () => {
  it("finds a value in three of twelve tables (text, jsonb, a number), by a regular expression, skips a table past its timeout and cancels mid-search", async () => {
    const m = await plugin();

    // A value equal to a text, to a number deep in a jsonb document and to an integer key; the big
    // table is left out by its size, the one of booleans has nothing to look in.
    const equal = await search(m, { value: "987654" });
    expect(equal.phase).toBe("done");
    expect(found(equal)).toEqual([
      ["customers", ["code"]],
      ["events", ["payload"]],
      ["orders", ["id"]],
    ]);
    expect(equal.tables.map((t) => t.rowsBy)).toEqual([["id"], "ctid", ["id"]]);
    expect(equal.skipped).toEqual([
      { table: `${SCHEMA}.big`, why: "over the size limit: about 1.5 million rows" },
    ]);
    expect(equal.searched).toBe(10);
    const run = panel(m)?.run;
    expect(run?.empty).toBe(1);
    // So few rows are read in full; a number in the big table's key is found by its index.
    expect(run?.tables.map((t) => t.scan)).toEqual(["full", "full", "full"]);

    // Each hit's filter finds its row: the key, else the ctid.
    const id = m.shown()?.id as string;
    for (const [t, rows] of [
      [0, 1],
      [1, 1],
      [2, 1],
    ] as const) {
      const { where } = (await act(m, "searchOpen", id, t, 0, 0)) as { where: string };
      const table = run?.tables[t]?.name;
      expect(admin(`SELECT count(*) FROM ${SCHEMA}.${table} WHERE ${where}`), where).toBe(
        String(rows),
      );
    }
    expect(m.view.said.at(-1)).toBe("orders: the row of id 987654.");

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

    // The big table searched too, under a one-second statement timeout: skipped, and said why.
    const slow = await search(m, {
      value: SLOW,
      match: "regex",
      big: true,
      timeoutSeconds: 1,
      tables: "big",
    });
    expect(slow).toMatchObject({
      phase: "done",
      tables: [],
      skipped: [{ table: `${SCHEMA}.big`, why: "past its timeout" }],
    });

    // Cancel while the big table is read: its statement stops on the server, no table after it is read.
    const started = act(m, "searchStart", id, {
      value: SLOW,
      match: "regex",
      big: true,
      timeoutSeconds: 60,
      tables: "",
      schemas: [SCHEMA],
    });
    for (let i = 0; i < 300 && panel(m)?.run?.current !== `${SCHEMA}.big`; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(panel(m)?.run?.current).toBe(`${SCHEMA}.big`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const asked = Date.now();
    await act(m, "searchCancel", id);
    await started;
    const elapsed = Date.now() - asked;
    const cancelled = panel(m)?.run;
    expect(cancelled?.phase).toBe("cancelled");
    expect([cancelled?.done, cancelled?.total]).toEqual([3, 12]);
    expect(cancelled?.skipped.map((s) => [s.name, s.why])).toEqual([["big", "cancelled"]]);
    expect(elapsed).toBeLessThan(1500);
    for (let i = 0; i < 50 && active() > 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    expect(active()).toBe(0);
    expect(m.view.said.at(-1)).toBe("No match; 2 tables searched, cancelled after 3 of 12 tables.");

    // A role refused one table: skipped as no permission, the rest searched.
    const password = randomUUID();
    admin(`DROP ROLE IF EXISTS ${ROLE}`);
    admin(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${password}'`);
    admin(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${ROLE}`);
    admin(`GRANT SELECT ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${ROLE}`);
    admin(`REVOKE SELECT ON ${SCHEMA}.customers FROM ${ROLE}`);
    const reader = await plugin({ user: ROLE, password });
    const refused = await search(reader, { value: "987654" });
    expect(found(refused)).toEqual([
      ["events", ["payload"]],
      ["orders", ["id"]],
    ]);
    expect(refused.skipped).toEqual([
      { table: `${SCHEMA}.big`, why: "over the size limit: about 1.5 million rows" },
      { table: `${SCHEMA}.customers`, why: "no permission to read it" },
    ]);
  }, 120_000);
});
