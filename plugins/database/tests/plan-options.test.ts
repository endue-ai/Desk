// PostgreSQL's EXPLAIN options (PG-70): the ones each server version has, the EXPLAIN they make,
// and the ones a person turned on, remembered per connection.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ON,
  explainPostgres,
  optionsFor,
  readOptions,
  saveOptions,
  versionOf,
} from "../ui/explain/options.js";
import { explainSql } from "../ui/explain/plan.js";

const names = (version: number) => optionsFor(version).map((o) => o.name);
const sql = (on: string[], version: number, analyze: boolean) =>
  explainPostgres("select 1", { on, version, analyze });

describe("EXPLAIN options", () => {
  it("offers the options each server version has", () => {
    const base = ["ANALYZE", "BUFFERS", "VERBOSE", "SETTINGS", "WAL", "TIMING", "SUMMARY"];
    expect(names(130000)).toEqual(base);
    expect(names(150004)).toEqual(base);
    expect(names(160016)).toEqual([...base, "GENERIC_PLAN"]);
    expect(names(170012)).toEqual([...base, "GENERIC_PLAN", "SERIALIZE", "MEMORY"]);
    expect(names(180007)).toEqual(names(170012));
    expect(versionOf("170012")).toBe(170012);
    expect(versionOf(" 130023\n")).toBe(130023);
    expect(versionOf("")).toBe(130000);
    expect(versionOf("not a version")).toBe(130000);
  });

  it("writes the EXPLAIN the options make", () => {
    const all = [
      "BUFFERS",
      "VERBOSE",
      "SETTINGS",
      "WAL",
      "TIMING",
      "SUMMARY",
      "SERIALIZE",
      "MEMORY",
    ];
    expect(sql(all, 170012, true)).toBe(
      "EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, WAL, TIMING, SUMMARY, SERIALIZE, MEMORY, FORMAT JSON) select 1",
    );
    // Without ANALYZE: WAL, TIMING and SERIALIZE need it and are left out.
    expect(sql(all, 170012, false)).toBe(
      "EXPLAIN (BUFFERS, VERBOSE, SETTINGS, SUMMARY, MEMORY, FORMAT JSON) select 1",
    );
    // An older server never gets what it does not have.
    expect(sql([...all, "GENERIC_PLAN"], 130023, false)).toBe(
      "EXPLAIN (BUFFERS, VERBOSE, SETTINGS, SUMMARY, FORMAT JSON) select 1",
    );
    // GENERIC_PLAN only without ANALYZE.
    expect(sql(["GENERIC_PLAN"], 160016, false)).toBe(
      "EXPLAIN (GENERIC_PLAN, FORMAT JSON) select 1",
    );
    expect(sql(["GENERIC_PLAN"], 160016, true)).toBe(
      "EXPLAIN (ANALYZE, TIMING FALSE, SUMMARY FALSE, FORMAT JSON) select 1",
    );
    // What the server turns on with ANALYZE and the person turned off is sent as FALSE.
    expect(sql([], 180007, true)).toBe(
      "EXPLAIN (ANALYZE, BUFFERS FALSE, TIMING FALSE, SUMMARY FALSE, FORMAT JSON) select 1",
    );
    expect(sql(DEFAULT_ON, 170012, true)).toBe(
      "EXPLAIN (ANALYZE, BUFFERS, TIMING, SUMMARY, FORMAT JSON) select 1",
    );
    expect(sql([], 170012, false)).toBe("EXPLAIN (FORMAT JSON) select 1");
    // The ANALYZE the caller asks for wins over the one in the list.
    expect(sql(["ANALYZE"], 170012, false)).toBe("EXPLAIN (FORMAT JSON) select 1");
    expect(
      explainSql("postgresql", "postgresql", "select 1", true, {
        on: ["VERBOSE"],
        version: 170012,
      }),
    ).toBe("EXPLAIN (ANALYZE, VERBOSE, TIMING FALSE, SUMMARY FALSE, FORMAT JSON) select 1");
  });

  it("remembers the options per connection", async () => {
    const store = new Map<string, unknown>();
    const bridge = {
      call: async (method: string, params: { key: string; value?: unknown }) => {
        if (method === "store.set") store.set(params.key, params.value);
        return store.has(params.key) ? { value: store.get(params.key) } : {};
      },
    } as never;
    expect(await readOptions(bridge, "c-a")).toEqual(DEFAULT_ON);
    await saveOptions(bridge, "c-a", ["ANALYZE", "VERBOSE", "NOT AN OPTION"]);
    expect(await readOptions(bridge, "c-a")).toEqual(["ANALYZE", "VERBOSE"]);
    expect(await readOptions(bridge, "c-b")).toEqual(DEFAULT_ON);
    await saveOptions(bridge, "c-b", []);
    expect(await readOptions(bridge, "c-b")).toEqual([]);
    expect(store.get("explain:c-a")).toEqual(["ANALYZE", "VERBOSE"]);
  });
});
