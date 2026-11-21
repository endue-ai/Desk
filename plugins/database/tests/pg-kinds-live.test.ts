// PG-50 against a real PostgreSQL, when ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database
// whose user may create databases, roles and event triggers: one of every new kind is made, read
// through the schema cache in the counted statements, and each DDL the explorer's `d` shows is
// applied in a fresh database (roles and the tablespace, which are the whole server's, under a new
// name); read back there, every DDL is the same. No secret an option holds leaves the server. On the
// desk core's sessions (core-bridge.ts), no psql.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCatalog } from "../ui/catalog.js";
import { createClients } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { createRunner } from "../ui/run.js";
import { DATABASE, isNewKind } from "../ui/schema/pg/index.js";
import { fromValues } from "../ui/settings.js";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";
import { memoryStore } from "./schema-cache-helpers";

const pgUri = process.env.ENDUE_DB_TEST_POSTGRES;
const S = "t474_k";
// Roles and tablespaces belong to the whole server, which other runs share: name them after this
// run's database, and its copy's after the copy's (renamed below).
const DATABASE_NAME = pgUri ? new URL(pgUri).pathname.slice(1) : "";
const R = `t474_${DATABASE_NAME.toLowerCase().replace(/[^a-z0-9_]/gu, "_")}`.slice(0, 40);
const RC = R.replace(/^t474_/u, "t474c_");
const SENTINEL = "SENTINEL-NOT-SHOWN";

/** What the fresh database needs before the DDL: the schema, two routines and three tables. */
const GROUNDWORK = [
  `CREATE SCHEMA ${S}`,
  `CREATE FUNCTION ${S}.add_int(integer, integer) RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT $1 + $2'`,
  `CREATE FUNCTION ${S}.on_ddl() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN END $$`,
  `CREATE TABLE ${S}.events (id int, at date NOT NULL) PARTITION BY RANGE (at)`,
  `CREATE TABLE ${S}.base (id int)`,
  `ALTER TABLE ${S}.base ENABLE ROW LEVEL SECURITY`,
];
/** One of every kind, in the database the URI names. */
const KINDS = [
  ...GROUNDWORK.slice(0, 5),
  `CREATE TABLE ${S}.child (extra text) INHERITS (${S}.base)`,
  GROUNDWORK[5] ?? "",
  `CREATE TYPE ${S}.mood AS ENUM ('sad', 'ok', 'so so')`,
  `COMMENT ON TYPE ${S}.mood IS 'How it went'`,
  `CREATE TYPE ${S}.pair AS (x integer, "Y z" text COLLATE "C")`,
  `CREATE DOMAIN ${S}.positive AS numeric(10,2) DEFAULT 1 NOT NULL CONSTRAINT positive_check CHECK (VALUE > 0)`,
  `CREATE TYPE ${S}.span AS RANGE (subtype = integer)`,
  `CREATE TYPE ${S}.four`,
  `CREATE FUNCTION ${S}.four_in(cstring) RETURNS ${S}.four LANGUAGE internal IMMUTABLE STRICT AS 'int4in'`,
  `CREATE FUNCTION ${S}.four_out(${S}.four) RETURNS cstring LANGUAGE internal IMMUTABLE STRICT AS 'int4out'`,
  `CREATE TYPE ${S}.four (INPUT = ${S}.four_in, OUTPUT = ${S}.four_out, INTERNALLENGTH = 4, PASSEDBYVALUE, ALIGNMENT = int4)`,
  `CREATE AGGREGATE ${S}.total(integer) (SFUNC = ${S}.add_int, STYPE = integer, INITCOND = '0')`,
  `COMMENT ON AGGREGATE ${S}.total(integer) IS 'Sums'`,
  `CREATE OPERATOR ${S}.### (FUNCTION = ${S}.add_int, LEFTARG = integer, RIGHTARG = integer, COMMUTATOR = OPERATOR(${S}.###))`,
  `CREATE COLLATION ${S}.plain (provider = libc, locale = 'C')`,
  `CREATE TEXT SEARCH CONFIGURATION ${S}.words (COPY = pg_catalog.english)`,
  `CREATE TABLE ${S}.events_2026 PARTITION OF ${S}.events FOR VALUES FROM ('2026-01-01') TO ('2027-01-01') PARTITION BY LIST (id)`,
  `CREATE TABLE ${S}.events_2026_one PARTITION OF ${S}.events_2026 FOR VALUES IN (1)`,
  `CREATE TABLE ${S}.events_rest PARTITION OF ${S}.events DEFAULT`,
  `CREATE POLICY own_rows ON ${S}.base AS RESTRICTIVE FOR SELECT TO public USING (id > 0)`,
  `CREATE RULE no_delete AS ON DELETE TO ${S}.child DO INSTEAD NOTHING`,
  `CREATE EXTENSION hstore WITH SCHEMA ${S}`,
  "CREATE FOREIGN DATA WRAPPER t474_wrapper",
  `CREATE SERVER t474_server FOREIGN DATA WRAPPER t474_wrapper OPTIONS (host 'db', password '${SENTINEL}')`,
  `CREATE USER MAPPING FOR CURRENT_USER SERVER t474_server OPTIONS (user 'u', password '${SENTINEL}')`,
  `CREATE PUBLICATION t474_pub FOR TABLE ${S}.base WITH (publish = 'insert, update')`,
  `CREATE SUBSCRIPTION t474_sub CONNECTION 'dbname=x password=${SENTINEL}' PUBLICATION t474_pub WITH (connect = false, slot_name = NONE)`,
  `CREATE EVENT TRIGGER t474_ddl ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION ${S}.on_ddl()`,
  `CREATE CAST (${S}.pair AS text) WITH INOUT AS ASSIGNMENT`,
  "CREATE LANGUAGE t474_pl HANDLER plpgsql_call_handler",
  `CREATE ROLE ${R}_reader NOLOGIN`,
  `CREATE ROLE ${R}_app LOGIN CONNECTION LIMIT 5 IN ROLE ${R}_reader`,
  `COMMENT ON ROLE ${R}_app IS 'The shop'`,
];
/** Everything of the database level the test made, dropped before and after. */
const DROPS = [
  "DROP EVENT TRIGGER IF EXISTS t474_ddl",
  "DROP SUBSCRIPTION IF EXISTS t474_sub",
  "DROP PUBLICATION IF EXISTS t474_pub",
  "DROP SERVER IF EXISTS t474_server CASCADE",
  "DROP FOREIGN DATA WRAPPER IF EXISTS t474_wrapper",
  "DROP LANGUAGE IF EXISTS t474_pl",
  `DROP SCHEMA IF EXISTS ${S} CASCADE`,
];
const SERVER_DROPS = [`${R}_app`, `${R}_reader`, `${RC}_app`, `${RC}_reader`].map(
  (r) => `DROP ROLE IF EXISTS ${r}`,
);
/** The order a fresh database takes the kinds in: what each needs comes before it. */
const ORDER = [
  "type",
  "aggregate",
  "operator",
  "collation",
  "text search configuration",
  "partition",
  "inherits",
  "policy",
  "rule",
  "extension",
  "foreign data wrapper",
  "foreign server",
  "user mapping",
  "publication",
  "subscription",
  "event trigger",
  "cast",
  "language",
  "role",
  "tablespace",
];
const SERVER_KINDS = new Set(["role", "tablespace"]);
const renamed = (text: string) => text.replaceAll('"t474_', '"t474c_');
/** Whether a role or tablespace is this run's, of the database or of its copy. */
const ours = (name: string) => name.startsWith(`${R}_`) || name.startsWith(`${RC}_`);

describe.skipIf(!pgUri)("PG-50's kinds on a real PostgreSQL", () => {
  const { fields, password } = parseUri(pgUri ?? "postgresql://localhost/x");
  const conn = normalize({ ...fields, id: "c-live", name: "live" });
  const copy = normalize({
    ...fields,
    database: `${conn.database}_kinds`,
    id: "c-copy",
    name: "copy",
  });
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
  /** A statement in a session of its own, one at a time (some cannot run in a transaction). */
  const run = async (on: typeof conn, sql: string) => {
    const done = await executor.execute(on, sql);
    const failed = done.result.error ?? done.result.statements.find((s) => s.error)?.error;
    if (failed) throw new Error(`${failed.message}\n${sql}`);
  };
  const catalogOn = (on: typeof conn) => {
    const sqls: string[] = [];
    const store = memoryStore();
    const catalog = createCatalog(
      (c, sql, options) => {
        sqls.push(sql);
        return executor.execute(c, sql, options);
      },
      () => false,
      { store },
    );
    return { catalog, sqls, on, store };
  };
  let inPlace = false;
  const dropAll = async () => {
    // A database with a subscription is not dropped: the copy's goes first.
    const there = await executor.execute(
      conn,
      `SELECT 1 FROM pg_catalog.pg_database WHERE datname = '${copy.database}'`,
    );
    if (there.result.statements[0]?.sets[0]?.rows.length)
      await run(copy, "DROP SUBSCRIPTION IF EXISTS t474_sub");
    await run(conn, `DROP DATABASE IF EXISTS ${copy.database} WITH (FORCE)`);
    for (const sql of [...DROPS, ...SERVER_DROPS]) await run(conn, sql);
    for (const name of [`${R}_space`, `${RC}_space`])
      await run(conn, `DROP TABLESPACE IF EXISTS ${name}`);
  };

  beforeAll(async () => {
    await dropAll();
    for (const sql of KINDS) await run(conn, sql);
    // A tablespace in place needs no directory on the server (PostgreSQL 15+).
    const version = await executor.execute(conn, "SHOW server_version_num");
    inPlace = Number(version.result.statements[0]?.sets[0]?.rows[0]?.[0]) >= 150000;
    if (inPlace)
      await run(
        conn,
        `SET allow_in_place_tablespaces = on;\nCREATE TABLESPACE ${R}_space LOCATION ''`,
      );
    await run(conn, `CREATE DATABASE ${copy.database}`);
  }, 120_000);
  afterAll(dropAll, 120_000);

  /** Every new kind's DDL in the test's schema and of what the test made at the database level. */
  const ddlsOf = async ({ catalog, on }: ReturnType<typeof catalogOn>) => {
    const out = new Map<string, string>();
    const objects = await catalog.objects(on, S);
    for (const o of objects.filter((o) => isNewKind(o.kind)))
      out.set(`${o.kind} ${o.name}`, await catalog.ddl(on, o));
    for (const table of objects.filter((o) => o.kind === "table"))
      for (const p of (await catalog.parts(on, S, table.name)).filter((p) => isNewKind(p.kind)))
        out.set(`${p.kind} ${table.name}.${p.name}`, await catalog.ddl(on, p));
    for (const o of await catalog.objects(on, DATABASE))
      if (/t474|hstore/u.test(o.name) && (!SERVER_KINDS.has(o.kind) || ours(o.name)))
        out.set(`${o.kind} ${o.name}`, await catalog.ddl(on, o));
    return out;
  };
  const read = async (side: ReturnType<typeof catalogOn>) => {
    await side.catalog.cache.open(side.on);
    await side.catalog.cache.choose(side.on, [S]);
    await side.catalog.cache.settled(side.on);
  };

  it("one of each kind round-trips", async () => {
    const source = catalogOn(conn);
    await read(source);
    source.sqls.length = 0;
    const report = await source.catalog.cache.refresh(conn, { all: true });
    expect(report).toEqual({ statements: 12, read: [S], database: true });

    const shown = await ddlsOf(source);
    for (const kind of ORDER.filter((k) => k !== "tablespace" || inPlace))
      expect(
        [...shown.keys()].some((key) => key.startsWith(`${kind} `)),
        kind,
      ).toBe(true);
    for (const text of shown.values()) expect(text).not.toContain(SENTINEL);
    expect(JSON.stringify([...source.store.values.values()])).not.toContain(SENTINEL);
    const base = (await source.catalog.objects(conn, S)).find((o) => o.name === "base");
    expect(base?.detail).toBe("RLS on");
    expect(base && (await source.catalog.ddl(conn, base))).toContain("ENABLE ROW LEVEL SECURITY");

    // The DDL applied in the fresh database, kind by kind; the server's own under new names.
    for (const sql of [...GROUNDWORK, `CREATE TABLE ${S}.child (id int, extra text)`])
      await run(copy, sql);
    const rank = (key: string) => ORDER.findIndex((k) => key.startsWith(`${k} `));
    const order = [...shown.entries()].sort(
      ([a, x], [b, y]) =>
        rank(a) - rank(b) ||
        Number(x.includes("GRANT")) - Number(y.includes("GRANT")) ||
        a.localeCompare(b),
    );
    // What is not shown is not made again: the server's hidden option stays behind.
    const hidden = /^-- \d+ options? (?:is|are) not shown.*\n/mu;
    const expected = new Map([...shown].map(([key, text]) => [key, text.replace(hidden, "")]));
    for (const [key, text] of order) {
      const kind = key.slice(0, key.indexOf(" "));
      const sql = SERVER_KINDS.has(kind) ? renamed(text) : text;
      if (SERVER_KINDS.has(kind)) expected.set(key.replace(" t474_", " t474c_"), sql);
      await run(copy, kind === "tablespace" ? `SET allow_in_place_tablespaces = on;\n${sql}` : sql);
    }

    const back = catalogOn(copy);
    await read(back);
    expect(Object.fromEntries(await ddlsOf(back))).toEqual(Object.fromEntries(expected));
  }, 240_000);
});
