// The schema cache on disk (PG-06, ADR 0285): the plugin's own store, an index and chunks of at
// most 60 KiB, at most 16 a connection; read back after a restart before the server answers; a
// cache of another server, another version or a half-written chunk is never read as the schema;
// and only names and definitions are kept.
import { describe, expect, it } from "vitest";
import { CHUNKS, chunkKey, indexKey } from "../ui/schema-cache/store.js";
import { kindOf, type PgCatalog, schemasOf, shop } from "./pg-catalog";
import { cacheOver, memoryStore, PG } from "./schema-cache-helpers";

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
/** `count` tables of five columns, each with a comment of `note` characters. */
const schemaOf = (mark: string, count: number, note: number): PgCatalog[string] => ({
  mark,
  tables: Array.from({ length: count }, (_, i) => ({
    name: `table_${String(i).padStart(4, "0")}`,
    columns: Array.from({ length: 5 }, (_, j) => [
      `column_${j}`,
      "character varying(200)",
      "",
      "",
      "é".repeat(note),
    ]),
  })),
});

describe("the schema cache on disk", () => {
  it("keeps the cache in the plugin's store and reads it back after a restart", async () => {
    const store = memoryStore();
    const model = shop();
    const first = cacheOver(() => model, { store });
    await first.cache.open(PG);
    expect([...store.values.keys()].sort()).toEqual([
      indexKey(PG.id),
      chunkKey(PG.id, 0),
      chunkKey(PG.id, 1),
    ]);
    expect(store.values.get(indexKey(PG.id))).toMatchObject({
      v: 1,
      where: "postgresql|db.example|5432|shop|app",
      chosen: null,
      kept: [
        ["public", "10.3:300", expect.any(Number), 0, 1],
        ["sales", "11.1:200", expect.any(Number), 1, 1],
      ],
    });

    // After a restart it answers at once; the server is asked for the fingerprints only.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const second = cacheOver(() => model, { store, gate });
    await second.cache.open(PG);
    expect(
      second.cache
        .view(PG)
        ?.columns("public", "people")
        ?.map((c) => c.name),
    ).toEqual(["id", "name", "joined"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(second.cache.view(PG)?.status.state).toBe("reading");
    release();
    await second.cache.settled(PG);
    expect(second.sqls.map(kindOf)).toEqual(["marks"]);
    expect(second.cache.view(PG)?.foreignKeys("public", "orders")).toEqual(
      first.cache.view(PG)?.foreignKeys("public", "orders"),
    );
  });

  it("chunks under 64 KiB a key and caps a connection at 16 chunks", async () => {
    const store = memoryStore();
    const model: PgCatalog = {
      public: schemaOf("1", 10, 10),
      big: schemaOf("2", 1500, 60),
      mid: schemaOf("3", 150, 60),
    };
    const first = cacheOver(() => model, { store });
    await first.cache.open(PG);
    const kept = [...store.values.entries()].filter(([, v]) => v !== null);
    for (const [, value] of kept) expect(bytes(value)).toBeLessThanOrEqual(64 * 1024);
    const chunks = kept.filter(([key]) => key.startsWith(`${indexKey(PG.id)}.`));
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.length).toBeLessThanOrEqual(CHUNKS);
    const index = store.values.get(indexKey(PG.id)) as { kept: [string][] };
    expect(index.kept.map((row) => row[0])).toEqual(["public", "mid"]);
    const view = first.cache.view(PG);
    expect([view?.held("big"), view?.kept("big"), view?.kept("mid")]).toEqual([true, false, true]);

    // After a restart the schema past the cap is the only one read again.
    const second = cacheOver(() => model, { store });
    await second.cache.open(PG);
    await second.cache.settled(PG);
    expect(second.sqls).toHaveLength(7);
    for (const sql of second.sqls.slice(1)) expect(schemasOf(sql)).toEqual(["big"]);
    expect(second.cache.view(PG)?.columns("mid", "table_0149")).toEqual(
      view?.columns("mid", "table_0149"),
    );
    expect(second.cache.view(PG)?.objects("mid")).toHaveLength(150);
  });

  it("a cache of another server, another version or a half-written chunk is not read as the schema", async () => {
    const model = shop();
    const store = memoryStore();
    const first = cacheOver(() => model, { store });
    await first.cache.open(PG);
    await first.cache.choose(PG, ["public", "sales"]);
    const again = async (conn = PG) => {
      const next = cacheOver(() => model, { store, conn });
      await next.cache.open(conn);
      await next.cache.settled(conn);
      return next;
    };
    const chosen = () => (store.values.get(indexKey(PG.id)) as { chosen: unknown }).chosen;

    // A chunk whose header does not match the index: that schema alone is read again.
    const text = store.values.get(chunkKey(PG.id, 0)) as string;
    store.values.set(chunkKey(PG.id, 0), text.replace(/^\["public",\d+/u, '["public",1'));
    const torn = await again();
    expect(torn.sqls.slice(1).map(schemasOf)).toEqual(Array(6).fill(["public"]));

    // Other kinds read everything again and keep the choice; another version keeps nothing.
    const index = store.values.get(indexKey(PG.id)) as Record<string, unknown>;
    store.values.set(indexKey(PG.id), { ...index, kinds: "relations" });
    const kinds = await again();
    expect(kinds.sqls.slice(1).map(schemasOf)).toEqual(Array(6).fill(["public", "sales"]));
    expect(chosen()).toEqual(["public", "sales"]);
    store.values.set(indexKey(PG.id), { ...index, v: 0 });
    expect((await again()).sqls).toHaveLength(7);
    expect(chosen()).toBeNull();

    // The same id pointed at another server reads everything.
    const moved = await again({ ...PG, host: "db2.example" });
    expect(moved.sqls).toHaveLength(7);
    expect(moved.cache.view(PG)).toBeUndefined();
  });

  it("holds names and definitions, never rows or routine bodies", async () => {
    const store = memoryStore();
    const { cache, sqls } = cacheOver(() => shop(), { store });
    await cache.open(PG);
    for (const sql of sqls) {
      expect(sql).not.toMatch(/pg_get_functiondef|pg_get_viewdef|prosrc/u);
      expect(sql).not.toMatch(/\b(?:FROM|JOIN)\s+(?!\(|pg_catalog\.)/u);
    }
    const kept = JSON.stringify([...store.values.values()]);
    expect(kept).toContain("orders_person_fkey");
    expect(kept).not.toMatch(/password|PGPASSWORD/iu);
    await cache.drop(PG.id);
    expect([...store.values.values()].every((v) => v === null)).toBe(true);
  });
});
