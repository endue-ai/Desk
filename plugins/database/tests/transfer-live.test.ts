// A copy between two databases on a real server (PG-63), through the desk core's sessions
// (core-bridge.ts). Two tables with keys, an index, a check, a generated column and a foreign key
// go from one database into a new schema of another, parents first, and compare equal row for row;
// the foreign key, the indexes and the sequences hold there. A query's result goes into a new table
// and is appended to an existing one by a column mapping. A copy cancelled mid-stream leaves
// nothing on the target. It runs when ENDUE_DB_TEST_POSTGRES holds a URI of a scratch database;
// the target is ENDUE_DB_TEST_POSTGRES_TARGET's database, else one the test makes and drops.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import type { TransferState } from "../ui/transfer/state.js";
import { type Mounted, mount } from "./harness";
import { databaseOf, liveSessions } from "./live-sessions";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const given = process.env.ENDUE_DB_TEST_POSTGRES_TARGET ?? "";
const made = uri && !given ? `${databaseOf(uri)}_transfer` : "";
const other = (() => {
  if (given || !uri) return given;
  const url = new URL(uri);
  url.pathname = `/${made}`;
  return url.toString();
})();
const { fields, password } = uri ? parseUri(uri) : { fields: {}, password: undefined };
const A = (uri ? normalize({ ...fields, id: "c-a", name: "source" }) : {}) as Connection;
const B = (
  uri ? normalize({ ...parseUri(other).fields, id: "c-b", name: "target" }) : {}
) as Connection;
const a = liveSessions(uri, "endue transfer");
const b = liveSessions(other, "endue transfer");
const ROWS = 20_000;

let answer: Record<string, unknown> = {};
let onCopy: (() => void) | undefined;

async function live(): Promise<Mounted> {
  const procs = realProcs(password ? { password } : {});
  const copy = procs.handlers["db.copy"] as unknown as (params: unknown) => Promise<unknown>;
  const m = await mount({
    store: { connections: [A, B] },
    handlers: {
      ...procs.handlers,
      "db.copy": async (params) => {
        const hook = onCopy;
        onCopy = undefined;
        hook?.();
        return (await copy(params)) as never;
      },
    },
    dialog: () => answer,
  });
  procs.attach((event) => m.host.emit(event));
  return m;
}

const panel = (m: Mounted) => m.shown()?.transfer as TransferState;
const sum = (side: typeof a, table: string) =>
  side.admin(`SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) FROM ${table} t`);

describe.skipIf(!uri)("copying between two databases on a real server", () => {
  beforeAll(async () => {
    if (made) {
      await a.admin(`DROP DATABASE IF EXISTS ${made}`);
      await a.admin(`CREATE DATABASE ${made}`);
    }
    await a.end();
    await b.end();
    await a.admin("DROP TABLE IF EXISTS orders, customers, big");
    await a.admin("CREATE TABLE customers (id serial PRIMARY KEY, name text NOT NULL UNIQUE)");
    await a.admin(
      "CREATE TABLE orders (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, customer_id int NOT NULL REFERENCES customers, total numeric(10,2) NOT NULL CHECK (total >= 0), note text, net numeric GENERATED ALWAYS AS (total / 1.2) STORED, at timestamptz DEFAULT now())",
    );
    await a.admin("CREATE INDEX orders_customer_idx ON orders (customer_id)");
    await a.admin(
      "INSERT INTO customers (name) SELECT 'customer ' || g FROM generate_series(1, 100) g",
    );
    await a.admin(
      `INSERT INTO orders (customer_id, total, note, at) SELECT 1 + g % 100, g / 4.0, CASE WHEN g % 9 = 0 THEN NULL ELSE E'tab\\there "q" é' END, timestamptz '2026-11-23 09:00+00' + g * interval '1 minute' FROM generate_series(1, ${ROWS}) g`,
    );
    await a.admin("CREATE TABLE big (id int PRIMARY KEY, pad text)");
    await a.admin(
      "INSERT INTO big SELECT g, repeat(md5(g::text), 8) FROM generate_series(1, 300000) g",
    );
    await b.admin("DROP SCHEMA IF EXISTS archive CASCADE");
    await b.admin("DROP TABLE IF EXISTS public.top_customers, public.names");
    await b.admin("CREATE TABLE public.names (id bigint, label text, extra int)");
  }, 120_000);
  afterAll(async () => {
    await a.end();
    await b.end();
    if (uri) await a.admin("DROP TABLE IF EXISTS orders, customers, big");
    if (made) await a.admin(`DROP DATABASE IF EXISTS ${made} WITH (FORCE)`);
    else if (other) {
      await b.admin("DROP SCHEMA IF EXISTS archive CASCADE");
      await b.admin("DROP TABLE IF EXISTS public.top_customers, public.names");
    }
  }, 60_000);

  it("copies two tables into a new schema of another database, parents first, equal row for row", async () => {
    const m = await live();
    answer = { target: B.id, schema: "archive", content: "both", foreignKeys: true };
    const { panel: id } = (await m.host.command("endue.database.transfer", {
      connection: A.name,
      schema: "public",
      tables: ["orders", "customers"],
    })) as { panel: string };
    expect(panel(m)).toMatchObject({ status: "ready", problems: [] });
    expect(panel(m).notes).toContain("Schema archive is created on the target.");
    expect(panel(m).steps.map((s) => s.target)).toEqual(["archive.customers", "archive.orders"]);
    const began = Date.now();
    await m.host.command("endue.database.transfer-start", { id });
    expect(panel(m)).toMatchObject({ status: "done", steps: [{ rows: 100 }, { rows: ROWS }] });
    for (const table of ["customers", "orders"])
      expect(await sum(b, `archive.${table}`)).toBe(await sum(a, `public.${table}`));
    expect(
      await b.admin(
        "SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid = 'archive.orders'::regclass AND contype IN ('f', 'c', 'p')",
      ),
    ).toBe("3");
    expect(
      await b.admin("SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname = 'archive'"),
    ).toBe("4");
    // The sequences went past the copied values, and the foreign key checks.
    expect(
      Number(
        await b.admin("INSERT INTO archive.orders (customer_id, total) VALUES (1, 1) RETURNING id"),
      ),
    ).toBe(ROWS + 1);
    expect(
      Number(await b.admin("INSERT INTO archive.customers (name) VALUES ('new') RETURNING id")),
    ).toBe(101);
    await expect(
      b.admin("INSERT INTO archive.orders (customer_id, total) VALUES (999, 1)"),
    ).rejects.toThrow(/foreign key/u);
    console.info(`copied ${ROWS + 100} rows in ${Date.now() - began} ms`);
  }, 120_000);

  it("a query's result goes into a new table and is appended to another by a column mapping", async () => {
    const m = await live();
    await m.host.command("endue.database.console", { connection: A.name });
    const type = (sql: string) => {
      m.view.text = sql;
      m.view.caret = sql.length;
      m.app.edited(sql);
    };
    type("select id, name from customers where id <= 10 order by id");
    answer = { target: B.id, schema: "public", name: "top_customers", append: false };
    const first = (await m.host.command("endue.database.transfer-query")) as { panel: string };
    expect(panel(m)).toMatchObject({ status: "ready" });
    await m.host.command("endue.database.transfer-start", { id: first.panel });
    expect(
      await b.admin("SELECT string_agg(name, ',' ORDER BY id) FROM public.top_customers"),
    ).toBe(Array.from({ length: 10 }, (_, i) => `customer ${i + 1}`).join(","));
    await m.host.command("endue.database.console", { connection: A.name });
    type("select id, name from customers where id <= 5");
    answer = { target: B.id, schema: "public", name: "names", append: true };
    const second = (await m.host.command("endue.database.transfer-query")) as { panel: string };
    expect(panel(m).mapping).toEqual([
      { source: "id", target: "id", choices: ["id", "label", "extra"] },
      { source: "name", target: "", choices: ["id", "label", "extra"] },
    ]);
    await (m.app as unknown as Record<string, (...args: unknown[]) => unknown>).transferMap?.(
      second.panel,
      "name",
      "label",
    );
    await m.settle();
    await m.host.command("endue.database.transfer-start", { id: second.panel });
    expect(
      await b.admin(
        "SELECT string_agg(id || '=' || label, ',' ORDER BY id) FROM public.names WHERE extra IS NULL",
      ),
    ).toBe("1=customer 1,2=customer 2,3=customer 3,4=customer 4,5=customer 5");
  }, 60_000);

  it("a copy cancelled mid-stream leaves nothing on the target", async () => {
    const m = await live();
    answer = {
      target: B.id,
      schema: "archive",
      name: "big_copy",
      content: "both",
      foreignKeys: true,
    };
    const { panel: id } = (await m.host.command("endue.database.transfer", {
      connection: A.name,
      schema: "public",
      table: "big",
    })) as { panel: string };
    let calls = 0;
    const cancelAfter = () => {
      onCopy = () => {
        calls++;
        if (calls < 3) cancelAfter();
        else void m.host.command("endue.database.transfer-cancel", { id });
      };
    };
    cancelAfter();
    await expect(m.host.command("endue.database.transfer-start", { id })).rejects.toThrow(
      /Cancelled/u,
    );
    expect(panel(m)).toMatchObject({
      status: "cancelled",
      result: "Cancelled: nothing was copied.",
    });
    expect(await b.admin("SELECT pg_catalog.to_regclass('archive.big_copy') IS NULL")).toBe("t");
    // Both sessions closed: none of this test's is left on either database.
    expect(
      await b.admin(
        "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND application_name NOT LIKE 'endue transfer %' AND pid <> pg_backend_pid() AND state = 'idle in transaction'",
      ),
    ).toBe("0");
  }, 60_000);
});
