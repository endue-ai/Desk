// Completion against a real PostgreSQL (PG-31, ADR 0327), when ENDUE_DB_TEST_POSTGRES holds the URI
// of a scratch database, on the desk core's sessions (no psql): the plugin's schema cache reads a
// schema with foreign keys (one of two columns), comments, defaults and a set-returning function;
// completion runs in the parse worker's service over what the cache holds, and what it writes (a
// join's ON condition, a `*` written out, INSERT's column list and VALUES row) is run by the server
// in a transaction never kept, which takes it and answers the same columns.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClients } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import { problemModel } from "../ui/diagnose/model.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { createRunner } from "../ui/run.js";
import { createSchemaCache } from "../ui/schema-cache/index.js";
import { fromValues } from "../ui/settings.js";
import { createService } from "../ui/sql/parse/worker.js";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";
import { loadRaw } from "./problems-fixture";
import { memoryStore } from "./schema-cache-helpers";

const pgUri = process.env.ENDUE_DB_TEST_POSTGRES;
const S = "t461_live";

type Item = {
  label: string;
  kind: string;
  insert: string;
  snippet?: boolean;
  info?: string;
  range?: { from: number; to: number };
};

describe.skipIf(!pgUri)("completion on a real PostgreSQL", () => {
  const { fields, password } = parseUri(pgUri ?? "postgres://");
  const conn = normalize({ ...fields, id: "c-live-461", name: "live" });
  const bridge = nodeBridge();
  const runner = createRunner(bridge);
  const settings = fromValues({});
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
  const run = async (sql: string) => {
    const done = await executor.execute(conn, sql);
    const failed = done.result.error ?? done.result.statements.find((s) => s.error)?.error;
    if (failed) throw new Error(failed.message);
    return done;
  };
  /** A statement run in a transaction never kept, under the schema: its columns' names. */
  const columnsOf = async (sql: string) => {
    const done = await run(`BEGIN;\nSET LOCAL search_path TO ${S};\n${sql}`);
    const set = done.result.statements.at(-1)?.sets[0];
    return set?.columns ?? [];
  };
  const cache = createSchemaCache({
    execute: (c, sql, options) => executor.execute(c, sql, options),
    store: memoryStore(),
    systemSchemas: () => false,
    changed: () => {},
  });

  beforeAll(async () => {
    await run(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
    await run(
      `CREATE SCHEMA ${S};\nSET search_path TO ${S};\n` +
        "CREATE TABLE customers (id int PRIMARY KEY, name text, email text);\n" +
        "COMMENT ON TABLE customers IS 'Who buys';\n" +
        "COMMENT ON COLUMN customers.name IS 'Full name';\n" +
        "CREATE TABLE orders (id serial PRIMARY KEY, customer_id int REFERENCES customers (id), total numeric(10,2), placed_at timestamptz DEFAULT now(), note text);\n" +
        "CREATE TABLE order_items (order_id int REFERENCES orders (id), line int, qty int, PRIMARY KEY (order_id, line));\n" +
        "CREATE TABLE shipments (order_id int, line int, at date, FOREIGN KEY (order_id, line) REFERENCES order_items (order_id, line));\n" +
        "CREATE FUNCTION customer_orders(c int) RETURNS TABLE (id int, total numeric) LANGUAGE sql AS 'SELECT id, total FROM orders WHERE customer_id = c';\n" +
        "COMMENT ON FUNCTION customer_orders(int) IS 'Orders of a customer'",
    );
  }, 60_000);
  afterAll(async () => {
    await run(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
  }, 60_000);

  it("what completion writes over the cached schema is what the server takes", async () => {
    await cache.open(conn);
    await cache.choose(conn, [S]);
    await cache.settled(conn);
    const model = problemModel(conn.id, cache.view(conn) as never);
    expect(model).not.toBeNull();
    const service = createService(await loadRaw());
    service.answer({ type: "model", key: 1, model: model as never });
    let id = 0;
    const at = (sql: string) => {
      const caret = sql.indexOf("|");
      const reply = service.answer({
        id: ++id,
        type: "complete",
        doc: "live",
        sql: sql.replace("|", ""),
        caret,
        offset: 0,
        model: 1,
        searchPath: [S],
        user: "",
      } as never) as { result: { from: number; to: number; items: Item[] } };
      return { caret, ...reply.result };
    };
    /** The statement with a candidate taken: its tab stops' names as written. */
    const taken = (sql: string, item: Item, from: number, to: number) => {
      const text = sql.replace("|", "");
      const span = item.range ?? { from, to };
      const insert = item.snippet ? item.insert.replace(/\$\{([^}]*)\}/gu, "$1") : item.insert;
      return `${text.slice(0, span.from)}${insert}${text.slice(Math.max(span.to, to))}`;
    };

    // A join from each foreign key, its ON condition the server takes.
    const join = at("select * from orders o join |");
    const joins = join.items.filter((i) => i.kind === "join");
    expect(joins.map((i) => i.insert)).toEqual([
      "customers on customers.id = o.customer_id",
      "order_items on order_items.order_id = o.id",
    ]);
    for (const item of joins)
      await columnsOf(taken("select * from orders o join |", item, join.from, join.to));
    const two = at("select * from order_items i join ship|");
    const ship = two.items.find((i) => i.kind === "join");
    expect(ship?.insert).toBe(
      "shipments on shipments.order_id = i.order_id and shipments.line = i.line",
    );
    await columnsOf(
      taken("select * from order_items i join ship|", ship as Item, two.from, two.to),
    );

    // `*` written out answers the same columns as `*`.
    const star = at("select *| from orders o join customers c on c.id = o.customer_id");
    const expand = star.items.find((i) => i.kind === "expand") as Item;
    const written = taken(
      "select *| from orders o join customers c on c.id = o.customer_id",
      expand,
      star.from,
      star.to,
    );
    const all = await columnsOf("select * from orders o join customers c on c.id = o.customer_id");
    expect(all).toHaveLength(8);
    expect(await columnsOf(written)).toEqual(all);

    // INSERT's column list without the defaults, and its VALUES row, run with values put in.
    const list = at("insert into customers (|");
    expect(list.items[0]).toMatchObject({ kind: "columns", label: "id, name, email" });
    const orders = at("insert into orders (|").items.filter((i) => i.kind === "columns");
    expect(orders.map((i) => i.label)).toEqual([
      "id, customer_id, total, placed_at, note",
      "customer_id, total, note",
    ]);
    const insert = taken("insert into orders (|", orders[1] as Item, 20, 20);
    expect(insert).toBe(
      "insert into orders (customer_id, total, note) values (customer_id, total, note)",
    );
    const values = insert.lastIndexOf("(");
    await columnsOf(
      `insert into customers (id, name, email) values (1, 'a', 'b');\n${insert.slice(0, values)}(1, 2.5, 'x')`,
    );

    // Comments come from the cache; a set-returning function's columns come from its result.
    expect(at("select na| from customers").items[0]).toMatchObject({
      label: "name",
      info: "Full name",
    });
    expect(at("select * from custom|").items[0]).toMatchObject({
      label: "customers",
      info: "Who buys",
    });
    const fn = at("select f.| from customer_orders(1) f").items.map((i) => i.label);
    expect(fn).toEqual(["id", "total"]);
    expect(await columnsOf("select * from customer_orders(1) f")).toEqual(fn);
  }, 120_000);
});
