// PG-82 on a real PostgreSQL, when ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database: a
// schema of its own with a function, a view, a materialized view, a trigger, a policy, a check and a
// default that all mention one column, read into the schema cache, then Database: search the source
// finds each of them with the line the server's own definition has it on, and a comment only when
// comments are searched. Other runs use the same server at once, so only this run's schema is made
// and dropped. On the desk core's sessions (core-bridge.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import { serverSession } from "./core-bridge";
import { mount } from "./harness";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES;
const S = "t492_src";
const admin = async (sql: string) => {
  const session = await serverSession(uri ?? "", "endue tests t492");
  try {
    return await session.run(sql);
  } finally {
    await session.close();
  }
};
const CREATES = [
  `CREATE SCHEMA ${S}`,
  `CREATE FUNCTION ${S}.t492_who() RETURNS int LANGUAGE sql AS 'SELECT 1'`,
  `CREATE TABLE ${S}.orders (id int PRIMARY KEY, t492_buyer int DEFAULT ${S}.t492_who() CHECK (t492_buyer > 0), note text DEFAULT 'no t492_buyer yet')`,
  `CREATE FUNCTION ${S}.t492_total(int) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  -- reads t492_buyer
  RETURN (SELECT count(*) FROM ${S}.orders WHERE t492_buyer = $1);
END
$$`,
  `CREATE FUNCTION ${S}.t492_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`,
  `CREATE TRIGGER t492_audit BEFORE UPDATE OF t492_buyer ON ${S}.orders FOR EACH ROW EXECUTE FUNCTION ${S}.t492_touch()`,
  `CREATE VIEW ${S}.buyers AS SELECT id, t492_buyer FROM ${S}.orders`,
  `CREATE MATERIALIZED VIEW ${S}.buyer_counts AS SELECT t492_buyer, count(*) FROM ${S}.orders GROUP BY 1`,
  `CREATE POLICY t492_mine ON ${S}.orders USING (t492_buyer = 1)`,
  `COMMENT ON TABLE ${S}.orders IS 'one row per t492_buyer order'`,
];

describe.skipIf(!uri)("the source search on a real server", () => {
  beforeAll(async () => {
    await admin(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
    for (const sql of CREATES) await admin(sql);
  }, 60_000);
  afterAll(async () => {
    await admin(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
  }, 60_000);

  it("finds every object that mentions a column, at its lines", { timeout: 60_000 }, async () => {
    const { fields, password } = parseUri(uri ?? "");
    const conn = normalize({ ...fields, id: "c-t492", name: "Server" });
    const procs = realProcs(password ? { password } : {});
    const m = await mount({
      store: { connections: [conn] },
      handlers: procs.handlers,
      pick: () => "yes",
    });
    procs.attach((event) => m.host.emit(event));
    await m.host.command("endue.database.reload-schema", { connection: "Server" });
    const ask = async (more: Record<string, unknown>) =>
      (await m.host.command("endue.database.search-source", {
        connection: "Server",
        text: "t492_buyer",
        scope: "schema",
        schema: S,
        ...more,
      })) as {
        phase: string;
        objects: { kind: string; object: string; lines: { line: number; text: string }[] }[];
      };
    const answer = await ask({});
    expect(answer.phase).toBe("done");
    const by = new Map(answer.objects.map((o) => [`${o.kind} ${o.object}`, o.lines]));
    expect([...by.keys()].sort()).toEqual(
      [
        `check ${S}.orders.orders_t492_buyer_check`,
        `default ${S}.orders.note`,
        `function ${S}.t492_total(integer)`,
        `materialized view ${S}.buyer_counts`,
        `policy ${S}.orders.t492_mine`,
        `trigger ${S}.orders.t492_audit`,
        `view ${S}.buyers`,
      ].sort(),
    );
    // The function's body as pg_get_functiondef writes it: the comment line is left out.
    const fn = by.get(`function ${S}.t492_total(integer)`) ?? [];
    expect(fn.map((l) => l.text.trim())).toEqual([
      `RETURN (SELECT count(*) FROM ${S}.orders WHERE t492_buyer = $1);`,
    ]);
    expect(fn[0]?.line).toBeGreaterThan(5);
    // A default is searched by its expression: t492_buyer's own default names no t492_buyer.
    expect(by.get(`default ${S}.orders.note`)?.[0]?.text).toContain("'no t492_buyer yet'");
    const withComments = await ask({ comments: true });
    const kinds = withComments.objects.map((o) => `${o.kind} ${o.object}`);
    expect(kinds).toContain(`comment ${S}.orders`);
    const commented = withComments.objects.find((o) => o.kind === "function");
    expect(commented?.lines.map((l) => l.text.trim())).toContain("-- reads t492_buyer");
  });
});
