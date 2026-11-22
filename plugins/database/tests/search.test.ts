// The value search through the plugin's commands and actions on the SDK's test host, against the
// scripted PostgreSQL of search-fixture.ts on the stub's sessions: the panel per connection with the
// estimate, each table searched in its own read-only run on a session of its own, the results
// grouped by table and column, the tables left out and why, a production connection asked first,
// Cancel of the run in flight on its session alone, a hit opened filtered, a partitioned table
// searched once, and an agent's search answered under the same limits.
import { describe, expect, it } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import type { SearchState } from "../ui/features/search/controller.js";
import { type Mounted, mount } from "./harness";
import { runsOf } from "./runs-of";
import { SEARCH_CONNECTION, type SearchServerOptions, searchServer } from "./search-fixture";

const conn = (fields: Partial<Connection>): Connection => ({ ...SEARCH_CONNECTION, ...fields });
const PROD = conn({ id: "c-ledger-prod", name: "ledger-prod", tag: "production" });
const LOCKED = conn({ id: "c-ledger-ro", name: "ledger-ro", readOnly: true });

async function start(
  options: SearchServerOptions & { pick?: (args: { title: string }) => string } = {},
) {
  const m = await mount({
    store: { connections: [SEARCH_CONNECTION, PROD, LOCKED] },
    script: searchServer(() => ({}), options),
    pick: options.pick ?? (() => "yes"),
  });
  return m;
}
const acts = (m: Mounted) =>
  m.app as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
const sqls = (m: Mounted) => m.sessions().flat();
/** The sessions a table's run had: read-only, its timeout, EXPLAIN, the search, COMMIT. */
const runs = (m: Mounted) => m.sessions().filter((s) => s.includes("BEGIN READ ONLY"));
const made = (m: Mounted, method: string) =>
  runsOf(m.host.calls)
    .filter((c) => c.method === method)
    .map((c) => c.params as Record<string, unknown>);
const searches = (m: Mounted) =>
  sqls(m).filter(
    (s) => /^SELECT .* FROM "/u.test(s) && / LIMIT \d+$/u.test(s) && s.includes("CASE WHEN"),
  );
const panel = (m: Mounted) => m.shown()?.search as SearchState;

describe("the value search", () => {
  it("searches each table on the server and lists the tables and columns with matches", async () => {
    const m = await start();
    await m.host.command("endue.database.search-data", { connection: "ledger" });
    const state = panel(m);
    expect(m.shown()).toMatchObject({ kind: "search", name: "search: ledger" });
    expect(state.schemas).toEqual(["public", "sales"]);
    expect(state.options.schemas).toEqual(["public", "sales"]);
    expect(state.estimate).toBe(
      "Reads 7 tables, about 80 thousand rows and 2 of unknown size, one at a time, read-only, at most 10 s each. Left out, over 1,000,000 rows: public.audit_log (about 5 million).",
    );
    const id = m.shown()?.id as string;
    await acts(m).searchStart?.(id, { value: "4242", match: "contains" });
    await m.settle();
    const run = panel(m).run;
    expect(run?.phase).toBe("done");
    expect(
      run?.tables.map((t) => [
        `${t.schema}.${t.name}`,
        t.scan,
        t.key.by,
        t.columns.map((c) => [c.name, c.count]),
      ]),
    ).toEqual([
      [
        "public.customers",
        "full",
        "key",
        [
          ["email", 1],
          ["note", 1],
        ],
      ],
      ["public.events", "full", "ctid", [["payload", 1]]],
      ["public.orders", "index", "key", [["id", 1]]],
      ["sales.invoices", "index", "key", [["number", 1]]],
    ]);
    expect(run?.tables[1]?.columns[0]?.hits).toEqual([
      { key: ["(0,1)"], text: '{"order": 4242, "kind": "refund"}' },
    ]);
    expect(run?.skipped.map((s) => [`${s.schema}.${s.name}`, s.why])).toEqual([
      ["public.audit_log", "size"],
      ["public.secrets", "permission"],
      ["sales.big_log", "timeout"],
    ]);
    expect(run?.empty).toBe(1);
    // Each table in its own run on a session of its own: read-only, its own timeout, EXPLAIN, then
    // the search.
    expect(runs(m)).toHaveLength(6);
    const first = runs(m)[0];
    expect(first?.slice(0, 3)).toEqual([
      "BEGIN READ ONLY",
      "SET LOCAL statement_timeout = 10000",
      expect.stringMatching(/^EXPLAIN SELECT "id", CASE WHEN/u),
    ]);
    expect(first?.at(-1)).toBe("COMMIT");
    // A uuid column never looks for a number, a boolean never at all.
    expect(searches(m).find((s) => s.includes('"public"."orders"'))).not.toContain('"ref"');
    expect(searches(m).some((s) => s.includes('"flags"'))).toBe(false);
    expect(m.view.said.at(-1)).toMatch(
      /^Found 5 rows in 4 tables \(5 columns\); 4 tables searched, 3 left out, in .+\.$/u,
    );
  });

  it("searches big tables too when asked, and only the tables named", async () => {
    const m = await start();
    await m.host.command("endue.database.search-data", { connection: "ledger" });
    const id = m.shown()?.id as string;
    await acts(m).searchStart?.(id, {
      value: "4242",
      match: "contains",
      big: true,
      tables: "audit_*, invoices",
    });
    const run = panel(m).run;
    expect(run?.total).toBe(2);
    expect(searches(m).map((s) => /FROM ("[^"]+"\."[^"]+")/u.exec(s)?.[1])).toEqual([
      '"public"."audit_log"',
      '"sales"."invoices"',
    ]);
  });

  it("says what it will scan first, and a production connection asks", async () => {
    const asked: string[] = [];
    const m = await start({
      pick: ({ title }) => {
        asked.push(title);
        return "no";
      },
    });
    await m.host.command("endue.database.search-data", { connection: "ledger-prod" });
    const id = m.shown()?.id as string;
    await acts(m).searchStart?.(id, { value: "4242" });
    expect(asked).toEqual(["Search 7 tables on ledger-prod?"]);
    expect(m.picks[0]?.items.map((i) => i.label)).toEqual([
      "Yes",
      expect.stringMatching(/^Reads 7 tables, about 80 thousand rows/u),
      "No",
    ]);
    expect(m.picks[0]?.items[0]).toMatchObject({ detail: "ledger-prod is tagged production." });
    expect(searches(m)).toEqual([]);
    expect(panel(m).run).toBeNull();
    // A read-only connection searches: a search only reads.
    await m.host.command("endue.database.search-data", {
      connection: "ledger-ro",
      value: "4242",
      match: "contains",
    });
    expect(panel(m).run?.phase).toBe("done");
    expect(made(m, "db.open").at(-1)).toMatchObject({ database: "ledger", readOnly: true });
  });

  it("skips a table with no permission or past its timeout and says why", async () => {
    const m = await start();
    const answer = (await m.host.command("endue.database.search-data", {
      connection: "ledger",
      value: "4242",
      match: "contains",
      tables: ["secrets", "big_log"],
    })) as { skipped: { table: string; why: string }[]; tables: unknown[] };
    expect(answer.tables).toEqual([]);
    expect(answer.skipped).toEqual([
      { table: "public.secrets", why: "no permission to read it" },
      { table: "sales.big_log", why: "past its timeout" },
    ]);
  });

  it("Cancel stops the statement running on its session and the tables after it", async () => {
    let m: Mounted | undefined;
    const seen: string[] = [];
    m = await start({
      // The events table's search runs on the server until it is cancelled.
      waits: "public.events",
      onSearch: (table) => {
        seen.push(table);
        const id = m?.shown()?.id as string;
        if (table === "public.events") setTimeout(() => void acts(m as Mounted).searchCancel?.(id));
      },
    });
    await m.host.command("endue.database.search-data", { connection: "ledger" });
    await acts(m).searchStart?.(m.shown()?.id as string, { value: "4242", match: "contains" });
    await m.settle();
    expect(seen).toEqual(["public.customers", "public.events"]);
    const run = panel(m).run;
    expect(run?.phase).toBe("cancelled");
    expect(run?.tables.map((t) => t.name)).toEqual(["customers"]);
    expect(run?.skipped.at(-1)).toMatchObject({ name: "events", why: "cancelled" });
    expect(m.view.said.at(-1)).toBe(
      "Found 2 rows in 1 table (2 columns); 1 table searched, 1 left out, cancelled after 3 of 8 tables.",
    );
    // db.cancel went to the events run's session alone, and no later table was read.
    const events = made(m, "db.run").find((p) => String(p.sql).includes('"events"'));
    expect(made(m, "db.cancel")).toEqual([{ sessionId: events?.sessionId }]);
    expect(searches(m).some((s) => s.includes('"orders"') || s.includes('"invoices"'))).toBe(false);
    await expect(m.host.command("endue.database.search-data-cancel")).rejects.toThrow(
      "No search is going on.",
    );
  });

  it("a hit opens the table filtered to its row: by its key, else by ctid, said so", async () => {
    const m = await start();
    await m.host.command("endue.database.search-data", {
      connection: "ledger",
      value: "4242",
      match: "contains",
    });
    const id = m.shown()?.id as string;
    await acts(m).searchOpen?.(id, 2, 0, 0);
    expect(m.shown()).toMatchObject({
      kind: "table",
      table: { schema: "public", name: "orders", where: `"id" = '4242'` },
    });
    expect(sqls(m).at(-1)).toMatch(
      /^SELECT \* FROM "public"\."orders" WHERE "id" = '4242' LIMIT /u,
    );
    expect(m.view.said.at(-1)).toBe("orders: the row of id 4242.");
    expect(m.shown()?.shown?.tabs[0]?.set?.rows).toEqual([
      ["4242", "1", "19.99", "7c9e6679-7425-40de-944b-e07fc1f90ae7", "2026-11-01"],
    ]);
    await acts(m).searchOpen?.(id, 1, 0, 0);
    expect(m.shown()?.table?.where).toBe("ctid = '(0,1)'::tid");
    expect(m.view.said.at(-1)).toMatch(/^events has no primary key: its row is found by its ctid/u);
    // A column opens the table filtered to all its matches.
    await acts(m).searchOpen?.(id, 0, 1);
    expect(m.shown()?.table?.where).toBe(`"note" LIKE '%4242%'`);
  });

  it("searches a partitioned table once, for its partitions' rows, and a hit opens it", async () => {
    // As the server's catalog does, the ledger lists the partitioned table and none of its
    // partitions: each row names the partition it lives in (tableoid).
    const m = await start({
      ledger: {
        public: [
          {
            name: "shipments",
            kind: "p",
            plan: "full",
            columns: [
              ["sent", "date", ""],
              ["code", "text", ""],
            ],
            rows: [
              ["2025-06-01", "4242"],
              ["2026-06-01", "A-4242"],
            ],
            ctids: ["(0,1)", "(0,1)"],
            parts: ["public.shipments_2025", "public.shipments_2026"],
          },
        ],
      },
    });
    const answer = await m.host.command("endue.database.search-data", {
      connection: "ledger",
      value: "4242",
      match: "contains",
    });
    expect(answer).toMatchObject({
      searched: 1,
      tables: [
        { table: "public.shipments", rowsBy: "ctid", columns: [{ column: "code", count: 2 }] },
      ],
      skipped: [],
    });
    expect(searches(m)).toHaveLength(1);
    expect(searches(m)[0]).toMatch(
      /^SELECT ctid::text, tableoid::regclass::text, CASE WHEN .* FROM "public"\."shipments" WHERE /u,
    );
    expect(sqls(m).some((s) => s.includes("shipments_20"))).toBe(false);
    // The hits are grouped under the partitioned table, each with its partition.
    const run = panel(m).run;
    expect(run?.total).toBe(1);
    expect(run?.tables[0]?.columns[0]?.hits.map((h) => h.key)).toEqual([
      ["(0,1)", "public.shipments_2025"],
      ["(0,1)", "public.shipments_2026"],
    ]);
    // A hit opens the partitioned table filtered to its row: its ctid in its partition.
    await acts(m).searchOpen?.(m.shown()?.id as string, 0, 0, 1);
    expect(m.shown()?.table).toMatchObject({
      schema: "public",
      name: "shipments",
      where: "ctid = '(0,1)'::tid AND tableoid = 'public.shipments_2026'::regclass",
    });
    expect(m.shown()?.shown?.tabs[0]?.set?.rows).toEqual([["2026-06-01", "A-4242"]]);
  });

  it("an agent's search answers the counts under the same limits", async () => {
    const m = await start();
    const answer = (await m.host.command("endue.database.search-data", {
      connection: "ledger",
      value: "4242",
      match: "contains",
      rowLimit: 5000,
      timeoutSeconds: 900,
      schemas: ["sales"],
    })) as Record<string, unknown>;
    expect(searches(m).every((s) => s.endsWith(" LIMIT 1001"))).toBe(true);
    expect(sqls(m)).toContain("SET LOCAL statement_timeout = 300000");
    expect(answer).toMatchObject({
      phase: "done",
      searched: 1,
      tables: [
        {
          table: "sales.invoices",
          scan: "index",
          rowsBy: ["id"],
          columns: [{ column: "number", count: 1, more: false, rows: [["1"]] }],
        },
      ],
      skipped: [{ table: "sales.big_log", why: "past its timeout" }],
    });
    // A regular expression the server does not read is said before any table is.
    const bad = await start({
      badRegex: "invalid regular expression: parentheses () not balanced",
    });
    const said = (await bad.host.command("endue.database.search-data", {
      connection: "ledger",
      value: "a(b",
      match: "regex",
    })) as { phase: string; error: string };
    expect(said).toMatchObject({
      phase: "failed",
      error:
        "not a regular expression the server reads: invalid regular expression: parentheses () not balanced",
    });
    expect(searches(bad)).toEqual([]);
  });
});
