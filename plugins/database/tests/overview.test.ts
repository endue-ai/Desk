// The server overview (ui/features/overview/) on the SDK's test host with a scripted psql: one
// panel per PostgreSQL connection with every section read in one run after the probe, a section the
// server refuses saying so while the rest are read in another run, pg_stat_statements explained
// instead of failing, Refresh, a section opened in the console as a normal result, a heavy statement
// put in the console unrun, and the versions' columns.
import { describe, expect, it } from "vitest";
import type { Console } from "../ui/consoles.js";
import type { OverviewState, Read } from "../ui/features/overview/read.js";
import { NOT_LOADED } from "../ui/features/overview/statements.js";
import { type Mounted, mount, SAVED } from "./harness";
import { OVERVIEW_CONNECTION, overviewServer, type ServerOptions } from "./overview-fixture";

const start = (options: ServerOptions = {}, pick?: (args: { title: string }) => string) =>
  mount({
    store: { connections: [...SAVED, OVERVIEW_CONNECTION] },
    script: overviewServer(undefined, options),
    ...(pick ? { pick } : {}),
  });

/** The psql runs after `--version`, and every statement they sent. */
const runs = (m: Mounted) =>
  m.clients.spawned.filter((s) => s.command === "psql" && s.args[0] !== "--version");
const sent = (m: Mounted) =>
  runs(m).flatMap((s) =>
    s.args.filter((a, i) => s.args[i - 1] === "-c" && !a.startsWith("\\") && a !== "BEGIN"),
  );

const overviewOf = (m: Mounted) => {
  const shown = m.view.consoles.findLast((c) => c.model?.kind === "overview")?.model as
    | Console
    | undefined;
  return shown?.overview as OverviewState;
};
const sectionOf = (m: Mounted, id: string) =>
  overviewOf(m).sections.find((s) => s.id === id) as Read;
const column = (section: Read, key: string) =>
  (section.rows ?? []).map((row) => row[(section.names ?? []).indexOf(key)]);

describe("the overview of a connection", () => {
  it("opens one overview per connection from the command", async () => {
    const m = await start();
    const said = await m.host.command("endue.database.overview", { connection: "reports" });
    expect(said).toBe("Read 17 of 17 sections of reports.");
    expect(m.shown()).toMatchObject({ kind: "overview", name: "overview: reports" });
    const state = overviewOf(m);
    expect(state).toMatchObject({ connection: "c-reports", reading: false });
    expect(state.server).toMatchObject({ versionNum: 170006, standby: false, role: "app" });
    expect(state.sections.filter((s) => s.failed)).toEqual([]);
    // Sizes, the largest first, with the table, its indexes and TOAST apart.
    const tables = sectionOf(m, "tables");
    expect(tables.names).toEqual(
      expect.arrayContaining(["total_bytes", "table_bytes", "index_bytes", "toast_bytes"]),
    );
    expect(column(tables, "table")[0]).toBe("orders");
    expect(column(sectionOf(m, "databases"), "database")).toContain("reports");
    expect(column(sectionOf(m, "schemas"), "schema")).toEqual(["public", "audit"]);
    // Indexes never or rarely scanned, duplicate and invalid ones; sequential scans.
    expect(column(sectionOf(m, "unused"), "index")).toContain("orders_note_idx");
    expect(column(sectionOf(m, "duplicates"), "indexes")[0]).toBe(
      "order_items_order_id_idx, order_items_order_idx",
    );
    expect(column(sectionOf(m, "invalid"), "index")).toEqual(["customers_email_idx"]);
    expect(column(sectionOf(m, "seqscans"), "table")[0]).toBe("customers");
    // Dead rows with the last vacuum and analyze and when autovacuum comes.
    const vacuum = sectionOf(m, "vacuum");
    expect(column(vacuum, "dead_rows")[0]).toBe("38000");
    expect(column(vacuum, "last_autovacuum")[0]).toMatch(/^2026-11-20/u);
    expect(column(vacuum, "own_settings")).toContain("autovacuum_enabled=false");
    expect(vacuum.note).toMatch(
      /^Autovacuum is on: a table is vacuumed past 50 dead rows plus 20%/u,
    );
    expect(column(sectionOf(m, "wraparound"), "wraparound_percent")[0]).toBe("8.49");
    expect(column(sectionOf(m, "cache"), "hit_percent")).toContain("74.96");
    // The server's figures: connections against the limit, each naming its statistic.
    const server = sectionOf(m, "server");
    expect(column(server, "figure")).toEqual(
      expect.arrayContaining(["Connections in use", "Connection limit"]),
    );
    expect(column(server, "statistic")).toContain("pg_stat_checkpointer");
    expect(column(sectionOf(m, "long"), "pid")).toEqual(["4321"]);
    expect(column(sectionOf(m, "replication"), "standby")).toEqual(["standby-a"]);
    expect(column(sectionOf(m, "slots"), "slot")).toEqual(["export_slot", "standby_a"]);
    expect(column(sectionOf(m, "settings"), "name")).toContain("work_mem");
    // Each figure counts since its statistic's reset.
    expect(sectionOf(m, "unused").since).toBe("2026-11-01 09:00:00+00");
    expect(sectionOf(m, "statements").since).toBe("2026-11-01 09:00:00+00");
    expect(column(sectionOf(m, "statements"), "total_ms")[0]).toBe("482211.52");
    // The probe, then every section in one run, each a read.
    expect(runs(m)).toHaveLength(2);
    expect(sent(m).every((sql) => /^(SELECT|WITH)\b/u.test(sql))).toBe(true);
    expect(sent(m)[1]).toBe("SELECT set_config('lock_timeout', '2s', false)");
    // Opened again, it is the same buffer, read again.
    await m.host.command("endue.database.overview", { connection: "reports" });
    const ids = new Set(
      m.view.consoles.filter((c) => c.model?.kind === "overview").map((c) => c.model?.id),
    );
    expect(ids.size).toBe(1);
    expect(runs(m)).toHaveLength(4);
  });

  it("says what a section could not read and reads the sections after it in another run", async () => {
    const m = await start({ deny: ["tables"], monitor: false });
    const said = await m.host.command("endue.database.overview", { connection: "reports" });
    expect(said).toBe("Read 16 of 17 sections of reports; 1 could not be read.");
    expect(sectionOf(m, "tables").failed).toBe(
      "app may not read pg_total_relation_size(), pg_table_size(), pg_indexes_size(), pg_class.reltuples: permission denied for table orders. A role with that privilege can; pg_monitor grants the statistics views.",
    );
    expect(sectionOf(m, "tables").rows).toBeUndefined();
    expect(column(sectionOf(m, "schemas"), "schema")).toEqual(["public", "audit"]);
    expect(column(sectionOf(m, "indexes"), "index")).toContain("orders_note_idx");
    expect(column(sectionOf(m, "settings"), "name")).toContain("work_mem");
    expect(runs(m)).toHaveLength(3);
    expect(overviewOf(m).server).toMatchObject({ allStats: false, allSettings: false });
  });

  it("explains pg_stat_statements instead of failing", async () => {
    const none = await start({ pgss: "none" });
    await none.host.command("endue.database.overview", { connection: "reports" });
    const steps = sectionOf(none, "statements");
    expect(steps.failed).toBeUndefined();
    expect(steps.missing).toMatch(/CREATE EXTENSION pg_stat_statements/u);
    expect(sent(none).some((sql) => /FROM "public"\.pg_stat_statements/u.test(sql))).toBe(false);
    expect(sent(none).some((sql) => /CREATE EXTENSION/iu.test(sql))).toBe(false);

    const unloaded = await start({ pgss: "unloaded" });
    const said = await unloaded.host.command("endue.database.overview", { connection: "reports" });
    expect(said).toBe("Read 17 of 17 sections of reports.");
    expect(sectionOf(unloaded, "statements")).toMatchObject({ missing: NOT_LOADED });
    expect(sectionOf(unloaded, "statements").failed).toBeUndefined();
    expect(column(sectionOf(unloaded, "long"), "pid")).toEqual(["4321"]);
  });

  it("refreshes, opens a section in the console as a result and a heavy statement unrun", async () => {
    const m = await start({}, () => "settings");
    // The recording view as an editor: an insert lands at the caret, a selection is kept.
    m.view.insert = (text) => {
      m.view.inserted.push(text);
      m.view.text += text;
      m.view.caret = m.view.text.length;
      m.view.selectionEnd = -1;
    };
    m.view.select = (from, to) => {
      m.view.caret = from;
      m.view.selectionEnd = to;
    };
    await m.host.command("endue.database.overview", { connection: "reports" });
    const at = overviewOf(m).at;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await m.host.command("endue.database.refresh-overview", {});
    expect(runs(m)).toHaveLength(4);
    expect(overviewOf(m).at).toBeGreaterThan(at);

    const tables = sectionOf(m, "tables");
    const summary = await m.host.command("endue.database.overview-result", {
      connection: "reports",
      section: "tables",
    });
    expect(summary).toMatch(/4 rows/u);
    const shown = m.shown();
    expect(shown).toMatchObject({ kind: "console", connection: "c-reports" });
    expect(m.view.inserted.at(-1)).toBe(`${tables.sql};`);
    expect(sent(m).at(-1)).toBe(tables.sql);
    const rows = shown?.shown?.tabs.find((t) => t.kind === "rows")?.set?.rows ?? [];
    expect(rows.map((r) => r[1])).toEqual(["orders", "events", "order_items", "customers"]);

    // Without a section named, the palette picks one.
    m.view.text = "";
    await m.host.command("endue.database.overview-result", { connection: "reports" });
    expect(m.picks.at(-1)?.title).toBe("Database: open which section in the console?");
    expect(sent(m).at(-1)).toBe(sectionOf(m, "settings").sql);

    const before = runs(m).length;
    const put = await m.host.command("endue.database.overview-statement", {
      connection: "reports",
      index: 0,
    });
    expect(put).toBe(
      "Statement 1 is in the console of reports: its parameters are asked for when it runs.",
    );
    expect(m.view.inserted.at(-1)).toBe(
      "SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT $2;",
    );
    expect(runs(m)).toHaveLength(before);
    await expect(
      m.host.command("endue.database.overview-result", { connection: "reports", section: "nope" }),
    ).rejects.toThrow("The overview has no section nope.");
  });

  it("refuses a connection that is not PostgreSQL, and says when the server could not be read", async () => {
    const m = await start();
    await expect(
      m.host.command("endue.database.overview", { connection: "Notes" }),
    ).rejects.toThrow("The overview reads PostgreSQL's statistics: Notes is a SQLite connection.");
    const down = await start({
      probeError: "permission denied for function pg_postmaster_start_time",
    });
    await expect(
      down.host.command("endue.database.overview", { connection: "reports" }),
    ).rejects.toThrow(
      "Could not read reports: permission denied for function pg_postmaster_start_time.",
    );
    expect(overviewOf(down)).toMatchObject({
      reading: false,
      failed: "Could not read reports: permission denied for function pg_postmaster_start_time.",
    });
    await expect(
      m.host.command("endue.database.overview-statement", { connection: "reports" }),
    ).rejects.toThrow("Read the overview of reports first (Database: server overview).");
  });

  it("reads PostgreSQL 13 with pg_stat_statements 1.8", async () => {
    const m = await start({ version: 13, pgss: "1.8" });
    await m.host.command("endue.database.overview", { connection: "reports" });
    expect(overviewOf(m).sections.filter((s) => s.failed)).toEqual([]);
    const all = sent(m).join("\n");
    expect(all).toContain("st.total_exec_time");
    expect(all).toContain("FROM pg_stat_bgwriter");
    expect(all).not.toMatch(
      /pg_stat_checkpointer|pg_stat_statements_info|last_idx_scan|last_seq_scan/u,
    );
    expect(sectionOf(m, "statements")).toMatchObject({ unrecorded: true });
    expect(sectionOf(m, "statements").since).toBeUndefined();
    expect(column(sectionOf(m, "server"), "statistic")).toContain("pg_stat_bgwriter");
  });
});
