// A diagram's record in the plugin's store (PG-55, ADR 0315, ui/features/diagram/kept.js): read back
// as written, per connection and diagram, a record past one key's 64 KiB in chunks under it, one
// past the cap not kept, and a torn chunk, another version or another diagram's record read as none.
import { describe, expect, it } from "vitest";
import {
  CHUNK,
  CHUNKS,
  type Record as Kept,
  keyOf,
  readKept,
  writeKept,
} from "../ui/features/diagram/kept.js";
import { memoryStore } from "./schema-cache-helpers";

const record = (tables: number, name = (i: number) => `table_${i}`): Kept => ({
  choice: { schemas: ["public"] },
  mode: "keys",
  at: Array.from({ length: tables }, (_, i) => ["public", name(i), i * 10, i * 20]),
  added: [["public", "notes"]],
  removed: [["public", "audit"]],
  drawn: [
    {
      from: ["public", "audit"],
      to: ["public", "customers"],
      columns: ["actor"],
      refColumns: ["id"],
    },
  ],
});
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

describe("the diagram's record", () => {
  it("keeps the layout per connection and diagram in the plugin's store", async () => {
    const store = memoryStore();
    const small = record(3);
    expect(await writeKept(store, "c-prod", "public", small)).toEqual({ kept: true, chunks: 0 });
    expect(await readKept(store, "c-prod", "public")).toEqual(small);
    expect(await readKept(store, "c-lite", "public")).toBeUndefined();
    expect(await readKept(store, "c-prod", "public.orders ±1")).toBeUndefined();
    for (const key of store.values.keys()) expect(key).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/u);
    expect(keyOf("c-prod", "public")).not.toBe(keyOf("c-lite", "public"));

    // Past one key: in chunks, each under 64 KiB as stored, and read back whole.
    const big = record(2000, (i) => `a_rather_long_table_name_for_the_diagram_${i}_ünïcode`);
    expect(bytes(big)).toBeGreaterThan(CHUNK);
    const wrote = await writeKept(store, "c-prod", "big", big, 42);
    expect(wrote.kept).toBe(true);
    expect(wrote.chunks).toBeGreaterThan(1);
    for (const value of store.values.values()) expect(bytes(value)).toBeLessThan(64 * 1024);
    expect(await readKept(store, "c-prod", "big")).toEqual(big);

    // A chunk an interrupted write left (another stamp) is never read as the record.
    const key = keyOf("c-prod", "big");
    store.values.set(`${key}.1`, { ...(store.values.get(`${key}.1`) as object), stamp: 7 });
    expect(await readKept(store, "c-prod", "big")).toBeUndefined();

    // Another version, or junk, is none.
    store.values.set(keyOf("c-prod", "public"), { v: 2, connection: "c-prod", id: "public" });
    expect(await readKept(store, "c-prod", "public")).toBeUndefined();
    store.values.set(keyOf("c-prod", "public"), "junk");
    expect(await readKept(store, "c-prod", "public")).toBeUndefined();

    // Past the cap: not written, and said so.
    const huge = record(CHUNKS * 1500, (i) => `${"x".repeat(40)}_${i}`);
    const before = store.sets.length;
    expect((await writeKept(store, "c-prod", "huge", huge)).kept).toBe(false);
    expect(store.sets.length).toBe(before);
  });
});
