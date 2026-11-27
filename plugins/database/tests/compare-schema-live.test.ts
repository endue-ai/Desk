// Two schemas compared on a real PostgreSQL, through the plugin's commands on the core's sessions
// (PG-53). It runs when ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database it may write in.
// Two schemas of their own, one a step ahead of the other in every kind the comparison reads (an
// enum, a domain, a sequence, a function, tables with keys, checks, an identity, a generated column,
// indexes and comments, a view, a materialized view and a trigger); the script run on the behind one,
// and the comparison again with no difference left; and the schema dumped to a folder that compares
// equal to it.
import { afterAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { SchemaState } from "../ui/features/compare-schema/controller.js";
import { split } from "../ui/sql/split.js";
import { type Mounted, mount } from "./harness";
import { liveSessions } from "./live-sessions";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const AHEAD = "endue_compare_ahead";
const BEHIND = "endue_compare_behind";
const live = liveSessions(uri, "compare-schema");
const admin = async (sql: string) => String(await live.admin(sql));
/** Each statement of a script, one after the other. */
const many = async (sql: string) => {
  for (const s of split(sql, "postgresql")) await admin(s.text.trim().replace(/;$/u, ""));
};

const COMMON = (s: string) => `
  CREATE SCHEMA ${s};
  CREATE TYPE ${s}.mood AS ENUM ('sad', 'ok');
  CREATE DOMAIN ${s}.positive AS integer CHECK (VALUE > 0);
  CREATE TABLE ${s}.people (id serial PRIMARY KEY, name text NOT NULL, mood ${s}.mood);
  CREATE TABLE ${s}.orders (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, person integer REFERENCES ${s}.people, qty ${s}.positive NOT NULL DEFAULT 1, total numeric(10,2) CHECK (total >= 0));
  CREATE INDEX orders_person ON ${s}.orders (person);
  CREATE FUNCTION ${s}.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
  CREATE VIEW ${s}.big AS SELECT id, total FROM ${s}.orders WHERE total > 100;
  CREATE TABLE ${s}.gone (id integer PRIMARY KEY);`;

const AHEAD_SQL = `${COMMON(AHEAD)}
  ALTER TYPE ${AHEAD}.mood ADD VALUE 'glad';
  ALTER TABLE ${AHEAD}.people ADD COLUMN email varchar(120), ADD COLUMN code text GENERATED ALWAYS AS (upper(name)) STORED, ALTER COLUMN name TYPE varchar(80);
  COMMENT ON TABLE ${AHEAD}.people IS 'Who buys';
  COMMENT ON COLUMN ${AHEAD}.people.email IS 'Where receipts go';
  CREATE UNIQUE INDEX people_email ON ${AHEAD}.people (lower(email)) WHERE email IS NOT NULL;
  ALTER TABLE ${AHEAD}.orders DROP CONSTRAINT orders_total_check, ADD CONSTRAINT orders_total_check CHECK (total > 0);
  CREATE SEQUENCE ${AHEAD}.ticket_no AS integer START WITH 100 INCREMENT BY 5;
  CREATE TABLE ${AHEAD}.tags (id integer PRIMARY KEY, person integer REFERENCES ${AHEAD}.people ON DELETE CASCADE, label text NOT NULL, ticket integer DEFAULT nextval('${AHEAD}.ticket_no'));
  CREATE OR REPLACE VIEW ${AHEAD}.big AS SELECT id, total FROM ${AHEAD}.orders WHERE total > 500;
  CREATE MATERIALIZED VIEW ${AHEAD}.per_person AS SELECT person, count(*) AS n FROM ${AHEAD}.orders GROUP BY person;
  CREATE FUNCTION ${AHEAD}.total_of(p integer) RETURNS numeric LANGUAGE sql STABLE AS $$ SELECT sum(total) FROM ${AHEAD}.orders WHERE person = p $$;
  CREATE TRIGGER orders_touch BEFORE UPDATE ON ${AHEAD}.orders FOR EACH ROW EXECUTE FUNCTION ${AHEAD}.touch();
  DROP TABLE ${AHEAD}.gone;`;

async function setUp() {
  await live.end();
  for (const s of [AHEAD, BEHIND]) await admin(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  await many(AHEAD_SQL);
  await many(COMMON(BEHIND));
  await many(
    `INSERT INTO ${BEHIND}.people (name) VALUES ('Ada'); INSERT INTO ${BEHIND}.orders (person, total) VALUES (1, 12.5)`,
  );
}

async function plugin() {
  const { fields, password } = parseUri(uri);
  const procs = realProcs(password ? { password } : {});
  const files: Record<string, string> = {};
  const m = await mount({
    store: { connections: [normalize({ ...fields, id: "c-live", name: "live" })] },
    pick: () => "yes",
    handlers: {
      ...procs.handlers,
      "fs.list": ({ path }) => {
        const prefix = `${path}/`;
        const names = new Map<string, "file" | "dir">();
        for (const p of Object.keys(files))
          if (p.startsWith(prefix)) {
            const [first, ...rest] = p.slice(prefix.length).split("/");
            names.set(first ?? "", rest.length ? "dir" : "file");
          }
        return { entries: [...names].map(([name, kind]) => ({ name, kind })) };
      },
      "fs.read": ({ path }) => ({ content: files[path] ?? "", encoding: "utf8" as const }),
      "fs.write": ({ path, content }) => {
        files[path] = content;
        return { bytesWritten: content.length };
      },
    },
  });
  procs.attach((event) => m.host.emit(event));
  return { m, files };
}
const state = (m: Mounted) =>
  (m.shown() as unknown as { schemaCompare: SchemaState }).schemaCompare;

afterAll(async () => {
  if (!uri) return;
  await live.end();
  for (const s of [AHEAD, BEHIND]) await admin(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
});

describe.skipIf(!uri)("two schemas compared on a real PostgreSQL", () => {
  // A setup, three compares, a migration and a dump: past the default 5 s on a server just started.
  it("applies the script to the target and compares again with no difference left", async () => {
    await setUp();
    const { m, files } = await plugin();
    const got = await m.host.command("endue.database.compare-schemas", {
      left: { connection: "live", schema: AHEAD },
      right: { connection: "live", schema: BEHIND },
    });
    expect(got).toMatchObject({ onlyLeft: 5, onlyRight: 1, differ: 4 });
    const kinds = state(m).items.map((i) => `${i.state} ${i.kind} ${i.name}`);
    expect(kinds).toEqual([
      "differs type mood",
      "left sequence ticket_no",
      "left function total_of(integer)",
      "right table gone",
      "differs table orders",
      "differs table people",
      "left table tags",
      "differs view big",
      "left materialized view per_person",
      "left trigger orders.orders_touch",
    ]);
    expect(state(m).script?.held).toEqual([]);
    const ran = (await m.host.command("endue.database.schema-compare-run")) as {
      ok: boolean;
      message: string;
    };
    expect(ran).toMatchObject({ ok: true });
    expect(ran.message).toContain("No difference is left.");
    expect(state(m)).toMatchObject({ status: "done", items: [] });
    // The rows of the behind schema are still there.
    expect(await admin(`SELECT name FROM ${BEHIND}.people`)).toBe("Ada");

    // Dumped to a folder, the schema compares equal to it.
    const dumped = (await m.host.command("endue.database.dump-schema", {
      connection: "live",
      schema: AHEAD,
      folder: "/dump",
    })) as { files: string[] };
    expect(dumped.files).toContain("tables/people.sql");
    expect(Object.keys(files)).toHaveLength(dumped.files.length);
    const back = await m.host.command("endue.database.compare-schemas", {
      left: { connection: "live", schema: AHEAD },
      right: { folder: "/dump" },
    });
    expect(back).toMatchObject({ onlyLeft: 0, onlyRight: 0, differ: 0 });
    expect(state(m).notes).toEqual([]);
  }, 60_000);
});
