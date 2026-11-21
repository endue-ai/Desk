// The SQL warnings against a real PostgreSQL (PG-36, ADR 0328), when ENDUE_DB_TEST_POSTGRES holds the
// URI of a scratch database, on the desk core's sessions (no psql): the plugin's schema cache reads a
// schema with NOT NULL and nullable columns, indexes and an expression index, the check warns over
// what it holds, and the server shows each reason true: no row for = NULL or a NOT IN that meets a
// NULL, the column cast in EXPLAIN's plan, an index unused under a function, every row paired, a
// view's * fixed when it was made. Each fix gives the rows, or writes the row, the statement meant.
// Everything the tests write is in a transaction that is never kept.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClients } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import { problemModel } from "../ui/diagnose/model.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { createRunner } from "../ui/run.js";
import { createSchemaCache } from "../ui/schema-cache/index.js";
import { fromValues } from "../ui/settings.js";
import type { SchemaModel } from "../ui/sql/parse/model.js";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";
import { checker } from "./problems-fixture";
import { memoryStore } from "./schema-cache-helpers";

const pgUri = process.env.ENDUE_DB_TEST_POSTGRES;
const S = "t466_live";

describe.skipIf(!pgUri)("SQL warnings on a real PostgreSQL", () => {
  const { fields, password } = parseUri(pgUri ?? "postgres://");
  const conn = normalize({ ...fields, id: "c-live-466", name: "live" });
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
  /** The rows of the script's last statement, run in a transaction that is rolled back. */
  const rows = async (sql: string) => {
    const done = await executor.execute(
      conn,
      `BEGIN;\nSET LOCAL search_path TO ${S};\n${sql};\nROLLBACK`,
    );
    const failed = done.result.error ?? done.result.statements.find((s) => s.error)?.error;
    if (failed) throw new Error(`${sql}: ${failed.message}`);
    const outcomes = done.result.statements;
    return outcomes[outcomes.length - 2]?.sets[0]?.rows ?? [];
  };
  const refusal = async (sql: string) => {
    const done = await executor.execute(conn, `BEGIN;\nSET LOCAL search_path TO ${S};\n${sql}`);
    return done.result.statements.find((s) => s.error)?.error?.message ?? null;
  };
  const plan = async (sql: string) =>
    (await rows(`SET LOCAL enable_seqscan TO off;\nEXPLAIN ${sql}`)).map((r) => r[0]).join("\n");
  const cache = createSchemaCache({
    execute: (c, sql, options) => executor.execute(c, sql, options),
    store: memoryStore(),
    systemSchemas: () => false,
    changed: () => {},
  });
  let model: SchemaModel | null = null;
  /** The warnings of `sql` over what the cache holds, as [identifier, fixed text]. */
  const warned = async (sql: string) => {
    const c = await checker();
    const found = c.check({ sql, searchPath: [S], user: "", warnings: true }, model).problems;
    return found
      .filter((p) => p.kind === "warning")
      .map((p) => {
        const w = p as typeof p & { rule: string; fix?: { text: string } };
        return [w.rule, w.fix ? `${sql.slice(0, p.from)}${w.fix.text}${sql.slice(p.to)}` : null];
      });
  };

  beforeAll(async () => {
    const setup = await executor.execute(
      conn,
      `DROP SCHEMA IF EXISTS ${S} CASCADE;\nCREATE SCHEMA ${S};\nSET search_path TO ${S};\n` +
        "CREATE TABLE people (id int PRIMARY KEY, name text, email varchar(200), code char(3), manager int);\n" +
        "CREATE INDEX people_email ON people (email);\n" +
        "CREATE INDEX people_lower_name ON people (lower(name));\n" +
        "CREATE TABLE orders (id bigint PRIMARY KEY, person int, total numeric(10,2));\n" +
        "CREATE TABLE tags (label text);\n" +
        "INSERT INTO people SELECT g, CASE WHEN g % 3 = 0 THEN NULL ELSE 'p' || g END, 'p' || g || '@x', 'ab', NULLIF(g % 4, 0) FROM generate_series(1, 300) g;\n" +
        "INSERT INTO orders VALUES (1, 1, 10), (2, NULL, 20), (3, 2, 30);\n" +
        "INSERT INTO tags VALUES ('a'), ('b');\n" +
        "ANALYZE people",
    );
    const failed = setup.result.statements.find((s) => s.error)?.error;
    if (failed) throw new Error(failed.message);
    await cache.open(conn);
    await cache.choose(conn, [S]);
    await cache.settled(conn);
    model = problemModel(conn.id, cache.view(conn) as never);
  }, 60_000);
  afterAll(async () => {
    await executor.execute(conn, `DROP SCHEMA IF EXISTS ${S} CASCADE`);
  }, 60_000);

  it("the cache gives the check NOT NULL and the indexes", () => {
    const people = model?.schemas
      .find((s) => s.name === S)
      ?.relations?.find((r) => r.name === "people");
    expect(people?.columns?.find((c) => c.name === "id")).toEqual({
      name: "id",
      type: "integer",
      notNull: true,
    });
    expect(people?.columns?.find((c) => c.name === "manager")).toEqual({
      name: "manager",
      type: "integer",
    });
    expect(people?.indexes).toEqual(
      expect.arrayContaining([
        `CREATE INDEX people_email ON ${S}.people USING btree (email)`,
        `CREATE INDEX people_lower_name ON ${S}.people USING btree (lower(name))`,
      ]),
    );
  });

  it("each reason holds on the server, and each fix gives what the statement meant", async () => {
    const nulls = "select count(*) from people where name = null";
    expect(await warned(nulls)).toEqual([
      ["null-comparison", "select count(*) from people where name is null"],
    ]);
    expect(await rows(nulls)).toEqual([["0"]]);
    expect(await rows("select count(*) from people where name is null")).toEqual([["100"]]);
    const not = "select count(*) from people where name <> null";
    expect(await rows(not)).toEqual([["0"]]);
    expect(await rows((await warned(not))[0]?.[1] as string)).toEqual([["200"]]);
    expect(
      await rows("select count(*) from people where case name when null then true end"),
    ).toEqual([["0"]]);

    const notIn = "select count(*) from people where id not in (select person from orders)";
    expect(await warned(notIn)).toEqual([["not-in-null", null]]);
    expect(await rows(notIn)).toEqual([["0"]]);
    expect(
      await rows(
        "select count(*) from people p where not exists (select 1 from orders o where o.person = p.id)",
      ),
    ).toEqual([["298"]]);
    // Over a NOT NULL column it is silent, and right.
    expect(
      await warned("select count(*) from people where manager not in (select id from orders)"),
    ).toEqual([]);

    // The column is cast where the check says, and not where it is silent.
    expect(await warned("select id from people where id = 1.5")).toEqual([["column-cast", null]]);
    expect(await plan("select id from people where id = 1.5")).toContain("(id)::numeric");
    expect(await warned("select id from people where code = 'ab'::text")).toEqual([
      ["column-cast", null],
    ]);
    expect(await plan("select id from people where code = 'ab'::text")).toContain("(code)::text");
    expect(await warned("select id from orders where total = 1")).toEqual([]);
    expect(await plan("select id from orders where total = 1")).not.toContain("(total)::");

    // A function over the indexed column leaves the index out; the column itself, or the
    // expression index, uses it.
    expect(await warned("select id from people where lower(email) = 'p1@x'")).toEqual([
      ["function-on-indexed-column", null],
    ]);
    expect(await plan("select id from people where lower(email) = 'p1@x'")).not.toContain(
      "people_email",
    );
    expect(await plan("select id from people where email = 'p1@x'")).toContain("people_email");
    expect(await warned("select id from people where lower(name) = 'p1'")).toEqual([]);
    expect(await plan("select id from people where lower(name) = 'p1'")).toContain(
      "people_lower_name",
    );

    // Nothing links the tables: every row pairs with every row.
    expect(await warned("select count(*) from people, orders")).toEqual([
      ["join-without-condition", null],
    ]);
    expect(await rows("select count(*) from people, orders")).toEqual([["900"]]);

    // A view's * is what the table had when the view was made.
    const view = "create view tv as select * from tags";
    expect(await warned(view)).toEqual([["select-star", null]]);
    expect(
      await rows(`${view};\nalter table tags add column extra int;\nselect * from tv limit 1`),
    ).toEqual([["a"]]);
    expect(await refusal(`${view};\nalter table tags drop column label`)).toMatch(
      /^cannot drop column label of table tags because other objects depend on it/u,
    );

    // The column list names the columns the values went to.
    const insert = "insert into people values (900, 'x')";
    const listed = (await warned(insert))[0]?.[1] as string;
    expect(listed).toBe("insert into people (id, name) values (900, 'x')");
    const after = "select id, name, email from people where id = 900";
    expect(await rows(`${listed};\n${after}`)).toEqual(await rows(`${insert};\n${after}`));

    // UPDATE without WHERE changes every row.
    expect(await warned("update people set code = 'zz'")).toEqual([["update-without-where", null]]);
    expect(
      await rows("update people set code = 'zz';\nselect count(*) from people where code = 'zz'"),
    ).toEqual([["300"]]);
  }, 120_000);
});
