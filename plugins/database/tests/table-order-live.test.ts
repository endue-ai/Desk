// A PostgreSQL table view's order on a real server (#564), through the plugin's commands on the desk
// core's sessions (core-bridge.ts). It runs when ENDUE_DB_TEST_POSTGRES holds the URI of a scratch
// database it may write in: a row edited in the grid and submitted keeps its place when the rows
// are read again (without ORDER BY the server would read it last), and the order the view picks
// runs on a table without a primary key, a materialized view, a partitioned table and a view.
import { afterAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import { mount } from "./harness";
import { liveSessions } from "./live-sessions";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const live = liveSessions(uri, "order");
const { admin } = live;
const NAMES = ["t564_keyed", "t564_heap", "t564_parted"];

async function plugin() {
  const { fields, password } = parseUri(uri);
  const conn = normalize({ ...fields, id: "c-live", name: "live" });
  const procs = realProcs(password ? { password } : {});
  const m = await mount({ store: { connections: [conn] }, handlers: procs.handlers });
  procs.attach((event) => m.host.emit(event));
  return m;
}
const shownRows = (m: Awaited<ReturnType<typeof plugin>>) =>
  m.shown()?.shown?.tabs[0]?.set?.rows.map((row) => row.join(" ")) ?? [];
const open = async (m: Awaited<ReturnType<typeof plugin>>, table: string) => {
  await m.host.command("endue.database.open-table", {
    connection: "live",
    schema: "public",
    table,
  });
  await m.settle();
};

afterAll(async () => {
  if (!uri) return;
  await admin("DROP VIEW IF EXISTS t564_view");
  await admin("DROP MATERIALIZED VIEW IF EXISTS t564_snap");
  for (const name of NAMES) await admin(`DROP TABLE IF EXISTS ${name}`);
});

describe.skipIf(!uri)("a table view's order on a real PostgreSQL", () => {
  it("keeps an edited row in its place after Submit, and reads each kind of relation", async () => {
    await admin("DROP VIEW IF EXISTS t564_view");
    await admin("DROP MATERIALIZED VIEW IF EXISTS t564_snap");
    for (const name of NAMES) await admin(`DROP TABLE IF EXISTS ${name}`);
    await admin("CREATE TABLE t564_keyed (id int PRIMARY KEY, note text)");
    await admin("INSERT INTO t564_keyed SELECT n, 'n' || n FROM generate_series(1, 5) n");
    await admin("CREATE TABLE t564_heap (n int, note text)");
    await admin("INSERT INTO t564_heap SELECT n, 'n' || n FROM generate_series(1, 3) n");
    await admin("CREATE MATERIALIZED VIEW t564_snap AS SELECT * FROM t564_heap");
    await admin("CREATE VIEW t564_view AS SELECT * FROM t564_keyed");
    await admin("CREATE TABLE t564_parted (id int, note text) PARTITION BY RANGE (id)");
    await admin("CREATE TABLE t564_parted_1 PARTITION OF t564_parted FOR VALUES FROM (0) TO (100)");
    await admin("INSERT INTO t564_parted VALUES (1, 'a'), (2, 'b')");

    const m = await plugin();
    await open(m, "t564_keyed");
    expect(shownRows(m)).toEqual(["1 n1", "2 n2", "3 n3", "4 n4", "5 n5"]);
    await m.app.editCell(1, 1, "two");
    await m.settle();
    expect(await m.host.command("endue.database.submit-changes")).toBe(
      "Committed 1 change in one transaction.",
    );
    await m.settle();
    expect(shownRows(m)).toEqual(["1 n1", "2 two", "3 n3", "4 n4", "5 n5"]);
    // Without ORDER BY the server reads the row it wrote anew last.
    expect(await admin("SELECT string_agg(id::text, ' ') FROM t564_keyed")).toBe("1 3 4 5 2");

    for (const [table, rows] of [
      ["t564_heap", ["1 n1", "2 n2", "3 n3"]],
      ["t564_snap", ["1 n1", "2 n2", "3 n3"]],
      ["t564_parted", ["1 a", "2 b"]],
      ["t564_view", ["1 n1", "2 two", "3 n3", "4 n4", "5 n5"]],
    ] as const) {
      await open(m, table);
      expect(m.shown()?.shown?.summary, table).toMatch(/^Done/u);
      expect(new Set(shownRows(m)), table).toEqual(new Set(rows));
    }
  }, 60_000);
});
