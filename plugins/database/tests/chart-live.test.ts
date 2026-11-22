// A selection's totals and a chart's sums against a real PostgreSQL (PG-44, ui/chart/aggregate.js),
// on the desk core's sessions (core-bridge.ts), no psql. It runs when ENDUE_DB_TEST_POSTGRES holds
// the URI of a scratch database, and creates nothing there: the values come from VALUES and
// generate_series, as the server prints numeric, bigint and double precision, and the server's own
// count, count(DISTINCT), sum, min and max are the answers the plugin's must equal, digit for digit.
import { afterAll, describe, expect, it } from "vitest";
import { groupChart, totalsOf } from "../ui/chart/aggregate.js";
import { serverSession } from "./core-bridge";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
type Own = Awaited<ReturnType<typeof serverSession>>;
let own: Own | undefined;
const session = async () => {
  own ??= await serverSession(uri, "chart live");
  return own;
};
afterAll(async () => {
  await own?.close();
});

/** Every row of a statement, as text. */
async function rows(sql: string) {
  const s = await session();
  const page = await s.page(sql);
  if (page.error) throw new Error(`${sql}: ${page.error.message}`);
  if (page.more) throw new Error(`${sql}: more than one page`);
  return page.rows;
}

const VALUES = `(VALUES
  ('a', 9007199254740993::numeric), ('a', 0.1), ('b', 0.2), ('b', NULL),
  ('a', 123456789012345678901234567890.123456789), ('c', -0.000000000000000001),
  ('c', 1e20), ('b', 0.10)) AS t(k, v)`;

describe.skipIf(!uri)("totals on the server's own numbers", () => {
  it("equal PostgreSQL's count, distinct count, sum, minimum and maximum of numeric", async () => {
    const values = (await rows(`SELECT v FROM ${VALUES}`)).map((r) => r[0] ?? null);
    const [server] = await rows(
      `SELECT count(v), count(DISTINCT v), sum(v), min(v), max(v), count(*) - count(v) FROM ${VALUES}`,
    );
    const totals = totalsOf(values);
    expect([
      String(totals.count),
      String(totals.distinct),
      totals.sum,
      totals.min,
      totals.max,
      String(totals.nulls),
    ]).toEqual(server);
  });

  it("averages exactly where the mean is exact", async () => {
    const values = (await rows("SELECT g::numeric / 7 FROM generate_series(1, 500) g")).map(
      (r) => r[0] ?? null,
    );
    // Five hundred values: the mean is the sum times 0.002, which numeric multiplies exactly.
    const [[server]] = (await rows(
      "SELECT trim_scale(sum(g::numeric / 7) * 0.002) FROM generate_series(1, 500) g",
    )) as [[string]];
    expect(totalsOf(values).average).toBe(server);
  });

  it("sum bigint past 2^53 and double precision as printed", async () => {
    const big = (
      await rows("SELECT (9007199254740000 + g)::bigint FROM generate_series(1, 500) g")
    ).map((r) => r[0] ?? null);
    const [[sum]] = (await rows(
      "SELECT sum((9007199254740000 + g)::bigint) FROM generate_series(1, 500) g",
    )) as [[string]];
    expect(totalsOf(big).sum).toBe(sum);
    const floats = (await rows("SELECT (g * 0.1)::float8 FROM generate_series(1, 10) g")).map(
      (r) => r[0] ?? null,
    );
    // The sum of the printed text, which is what the grid shows: 5.5, never 5.500000000000001.
    expect(totalsOf(floats).sum).toBe("5.5");
  });

  it("group a chart's sums by a column as GROUP BY does", async () => {
    const got = await rows(`SELECT k, v FROM ${VALUES}`);
    const server = await rows(`SELECT k, sum(v)::text FROM ${VALUES} GROUP BY k ORDER BY k`);
    const data = groupChart({
      count: got.length,
      value: (row, col) => got[row]?.[col] ?? null,
      columns: ["k", "v"],
      settings: { type: "bar", x: "k", y: "v", series: "", aggregate: "sum" },
    });
    const ours = data.categories.map((k, i) => [k, data.series[0]?.values[i] ?? null]).sort();
    expect(ours).toEqual(server);
  });
});
