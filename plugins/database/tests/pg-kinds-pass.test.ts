// PG-50's kinds in the schema cache's pass: three more readers per schema and two of the database
// level, each one statement however many objects; a change reads only its level; the statements ask
// for what the server's version has; no secret is read; and the database level is kept in the store
// with the schemas, under the same cap.
import { describe, expect, it } from "vitest";
import { indexKey } from "../ui/schema-cache/store.js";
import { kindOf, type PgCatalog, schemasOf, shop } from "./pg-catalog";
import { cacheOver, memoryStore, PG } from "./schema-cache-helpers";

const PER_SCHEMA = ["types", "objects", "table parts"];
const LEVEL = ["database", "server"];
const PASS = [
  "marks",
  "relations",
  "columns",
  "constraints",
  "indexes",
  "triggers",
  "routines",
  ...PER_SCHEMA,
  ...LEVEL,
];
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const many = (count: number, row: (i: number) => string[]) =>
  Array.from({ length: count }, (_, i) => row(i));

describe("PG-50's kinds in the schema cache's pass", () => {
  it("a pass reads every new kind in a fixed number of statements", async () => {
    const small = cacheOver(() => shop());
    await small.cache.open(PG);
    expect(small.sqls.map(kindOf)).toEqual(PASS);
    for (const sql of small.sqls.slice(1, 10)) expect(schemasOf(sql)).toEqual(["public", "sales"]);
    for (const sql of small.sqls.slice(10)) expect(schemasOf(sql)).toEqual([]);

    // Ten thousand types and ten thousand roles take the same twelve statements.
    const model = shop();
    const types = model.public?.rows?.types ?? [];
    types.push(...many(10_000, (i) => [`mood_${i}`, "e", '["a"]', "app", String(20_000 + i), ""]));
    const roles = model[""]?.rows?.server ?? [];
    roles.push(
      ...many(10_000, (i) => ["role", `member_${i}`, "", "{}", "", String(40_000 + i), ""]),
    );
    const big = cacheOver(() => model);
    await big.cache.open(PG);
    expect(big.sqls).toHaveLength(12);
    const view = big.cache.view(PG);
    expect(view?.objects("public")?.filter((o) => o.kind === "type")).toHaveLength(10_005);
    expect(view?.objects("")?.filter((o) => o.kind === "role")).toHaveLength(10_002);
  });

  it("a change reads only its level", async () => {
    const model = shop();
    const { cache, sqls } = cacheOver(() => model);
    await cache.open(PG);

    // A schema's change: that schema's ten statements.
    (model.public as { mark: string }).mark = "10.4:400";
    sqls.length = 0;
    expect(await cache.refresh(PG)).toEqual({ statements: 10, read: ["public"] });
    expect(sqls.map(kindOf)).toEqual(PASS.slice(0, 10));

    // An extension made, a role changed: the database level alone, in three.
    (model[""] as { mark: string }).mark = "2:300.2:200";
    sqls.length = 0;
    expect(await cache.refresh(PG)).toEqual({ statements: 3, read: [], database: true });
    expect(sqls.map(kindOf)).toEqual(["marks", ...LEVEL]);

    // Nothing changed: the fingerprints alone.
    sqls.length = 0;
    expect(await cache.refresh(PG)).toEqual({ statements: 1, read: [] });
  });

  it("asks only for what the server's version has", async () => {
    const LATER =
      /pg_publication_namespace|prqual|prattrs|subbinary|substream|subtwophasestate|subdisableonerr|suborigin|subpasswordrequired|subrunasowner|subfailover/u;
    const statementsOn = async (version: string) => {
      const model: PgCatalog = { ...shop(), "": { mark: "1", version } };
      const { cache, sqls } = cacheOver(() => model);
      await cache.open(PG);
      return sqls.join("\n");
    };
    expect(await statementsOn("130012")).not.toMatch(LATER);
    const newest = await statementsOn("170012");
    for (const name of LATER.source.split("|")) expect(newest).toContain(name);
    // 14 adds binary and streaming, 15 two-phase and disable on error, 16 origin and the rest.
    expect(await statementsOn("140010")).toMatch(/subbinary.*substream/su);
    expect(await statementsOn("140010")).not.toMatch(/subtwophasestate|pg_publication_namespace/u);
    expect(await statementsOn("150005")).not.toMatch(/suborigin|subfailover/u);
  });

  it("never reads a secret", async () => {
    const { cache, sqls } = cacheOver(() => shop());
    await cache.open(PG);
    for (const sql of sqls) {
      // pg_authid is named only as the class a role's comment belongs to, never read.
      const read = sql.replaceAll("'pg_catalog.pg_authid'::pg_catalog.regclass", "");
      expect(read).not.toMatch(/umoptions|subconninfo|rolpassword|pg_authid|pg_shadow|ftoptions/u);
      // Options are read only through the filter that drops those whose name may hold a secret.
      const filtered = sql.replaceAll(
        /unnest\((?:w\.fdwoptions|s\.srvoptions)\) o WHERE pg_catalog\.split_part\(o, '=', 1\) !?~\* '\(pass\|secret\|token\|key\)'/gu,
        "",
      );
      expect(filtered).not.toMatch(/fdwoptions|srvoptions/u);
    }
  });

  it("the database level is kept with the schemas and under the same cap", async () => {
    const store = memoryStore();
    const model = shop();
    const roles = model[""]?.rows?.server ?? [];
    roles.push(
      ...many(3_000, (i) => [
        "role",
        `member_${i}`,
        "",
        '{"login":false}',
        "",
        String(40_000 + i),
        "é".repeat(60),
      ]),
    );
    model.big = {
      mark: "9",
      tables: many(1_500, (i) => [`table_${i}`]).map(([name]) => ({
        name: name ?? "",
        columns: many(5, (j) => [`column_${j}`, "text", "", "", "é".repeat(60)]),
      })),
    };
    const first = cacheOver(() => model, { store });
    await first.cache.open(PG);
    for (const value of store.values.values()) expect(bytes(value)).toBeLessThanOrEqual(64 * 1024);
    const index = store.values.get(indexKey(PG.id)) as { kept: [string][] };
    expect(index.kept.map((row) => row[0])).toEqual(["", "public", "sales"]);
    const view = first.cache.view(PG);
    expect([view?.kept(""), view?.kept("big"), view?.held("big")]).toEqual([true, false, true]);

    // After a restart the database level answers from the store; only the schema past the cap is read.
    const second = cacheOver(() => model, { store });
    await second.cache.open(PG);
    expect(
      second.cache
        .view(PG)
        ?.objects("")
        ?.filter((o) => o.kind === "role"),
    ).toHaveLength(3_002);
    await second.cache.settled(PG);
    expect(second.sqls.map(kindOf)).toEqual(PASS.slice(0, 10));
    for (const sql of second.sqls.slice(1)) expect(schemasOf(sql)).toEqual(["big"]);
  });
});
