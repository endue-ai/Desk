// A maintenance form's run through the plugin's commands and actions on the SDK's test host, against
// the scripted PostgreSQL of maintenance-fixture.ts: the statement sent alone outside a transaction
// block, the server's output and the statistics before and after, the guards (read-only,
// production, an agent), the progress views while a run is held open, and the cancel of its
// session on the server.
import { describe, expect, it, vi } from "vitest";
import { RAN_AT } from "./maintenance-fixture";
import { acts, MAINTENANCE, node, ORDERS, start, statementsOf } from "./maintenance-host";

describe("running", () => {
  it("sends the statement alone, outside a transaction block, and shows the server's output and the statistics before and after", async () => {
    const { m, server, sent } = await start();
    await acts(m).maintain?.(ORDERS);
    const id = m.shown()?.id as string;
    await acts(m).maintenanceView?.(id, { options: { analyze: true } });
    await acts(m).maintenanceRun?.(id);
    expect(server.ran).toEqual(["VACUUM (VERBOSE, ANALYZE) public.orders"]);
    const run = sent.find((args) => args.includes("VACUUM (VERBOSE, ANALYZE) public.orders")) ?? [];
    expect(statementsOf(run)).toEqual(["VACUUM (VERBOSE, ANALYZE) public.orders"]);
    expect(run).not.toContain("--single-transaction");
    expect(run).not.toContain("BEGIN");
    const done = m.shown()?.maintenance.run;
    expect(done).toMatchObject({
      status: "done",
      error: "",
      sql: "VACUUM (VERBOSE, ANALYZE) public.orders",
    });
    expect(done.output).toEqual([
      'INFO:  vacuuming "warehouse.public.orders"',
      "tuples: 30000 removed, 120000 remain, 0 are dead but not yet removable",
    ]);
    expect(done.before).toMatchObject({ dead: 30000, lastVacuum: null, lastAnalyze: null });
    expect(done.after).toMatchObject({ dead: 0, lastVacuum: RAN_AT, lastAnalyze: RAN_AT });
    expect(m.shown()?.maintenance.read.stats).toEqual(done.after);
    expect(m.view.said.at(-1)).toMatch(/^VACUUM of public\.orders done in \d+ ms\.$/u);
    // From the palette: the form on screen runs again.
    await m.host.command("endue.database.maintenance-run");
    expect(server.ran).toHaveLength(2);
    // REINDEX CONCURRENTLY and CLUSTER of the whole database go the same way.
    await acts(m).maintain?.(node({ kind: "connection", label: "warehouse" }));
    const db = m.shown()?.id as string;
    await acts(m).maintenanceView?.(db, { operation: "reindex" });
    await acts(m).maintenanceRun?.(db);
    await acts(m).maintenanceView?.(db, { operation: "cluster" });
    await acts(m).maintenanceRun?.(db);
    expect(server.ran.slice(2)).toEqual([
      "REINDEX (VERBOSE) DATABASE CONCURRENTLY warehouse",
      "CLUSTER (VERBOSE)",
    ]);
    for (const args of sent.filter((a) => a.some((x) => MAINTENANCE.test(x)))) {
      expect(statementsOf(args)).toHaveLength(1);
      expect(args).not.toContain("--single-transaction");
    }
  });

  it("a read-only connection refuses, production asks naming it, and an agent's run waits for the person's yes", async () => {
    let answer = "yes";
    const { m, server } = await start({ pick: () => answer });
    await m.host.command("endue.database.maintenance", {
      connection: "locked",
      schema: "public",
      table: "orders",
    });
    expect(m.shown()?.maintenance.read).not.toBeNull();
    await expect(m.host.command("endue.database.maintenance-run")).rejects.toThrow(
      "locked is read-only: VACUUM, ANALYZE, REINDEX and CLUSTER do not run on it.",
    );
    expect(server.ran).toEqual([]);
    // Production: asked, naming it, with the statement.
    await m.host.command("endue.database.maintenance", {
      connection: "prod",
      schema: "public",
      table: "orders",
    });
    await m.host.command("endue.database.maintenance-run");
    expect(m.picks.at(-1)?.title).toBe("Run this statement on prod?");
    const items = m.picks.at(-1)?.items as Array<{ label: string; detail?: string }>;
    expect(items.map((i) => i.detail ?? i.label)).toEqual([
      "prod is tagged production.",
      "VACUUM (VERBOSE) public.orders",
      "No",
    ]);
    expect(server.ran).toEqual(["VACUUM (VERBOSE) public.orders"]);
    answer = "no";
    await expect(m.host.command("endue.database.maintenance-run")).rejects.toThrow("Not run.");
    expect(server.ran).toHaveLength(1);
    expect(m.shown()?.maintenance.run).toBeNull();
    // An agent's run asks first on any connection; a no runs nothing.
    const agent = {
      connection: "warehouse",
      schema: "public",
      table: "stock",
      operation: "analyze",
      run: true,
    };
    await expect(m.host.command("endue.database.maintenance", agent)).rejects.toThrow("Not run.");
    expect(m.picks.at(-1)?.title).toBe("Run this statement on warehouse?");
    expect(m.picks.at(-1)?.items[0]).toMatchObject({
      id: "yes",
      detail: "An agent asks to change data.",
    });
    expect(server.ran).toHaveLength(1);
    answer = "yes";
    const ran = (await m.host.command("endue.database.maintenance", agent)) as Record<
      string,
      unknown
    >;
    expect(ran).toMatchObject({ statement: "ANALYZE (VERBOSE) public.stock", status: "done" });
    expect(ran.after).toMatchObject({ lastAnalyze: RAN_AT });
    expect(server.ran.at(-1)).toBe("ANALYZE (VERBOSE) public.stock");
  });

  it("reads progress from the server's progress views while it runs and cancels the run on the server", async () => {
    const { m, server, held, sent } = await start({ hold: true });
    await acts(m).maintain?.(ORDERS);
    const id = m.shown()?.id as string;
    await acts(m).maintenanceView?.(id, { options: { full: true } });
    const running = acts(m).maintenanceRun?.(id);
    // Its db.run is held open, as a long statement on a real server: the host does not settle.
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(m.shown()?.maintenance.run).toMatchObject({
      status: "running",
      sql: "VACUUM (FULL, VERBOSE) public.orders",
      reads: 0,
    });
    // Waiting for a lock another session holds.
    const empty = Array(18).fill("");
    server.progress = ["4321", "Lock", "relation", "4242", "2500", ...empty];
    await acts(m).maintenanceProgress?.(id);
    expect(m.shown()?.maintenance.run).toMatchObject({
      reads: 1,
      progress: {
        pid: 4321,
        wait: "Lock: relation",
        blockedBy: [4242],
        ms: 2500,
        command: "",
        phase: "",
      },
    });
    const read = sent.at(-1)?.find((a) => a.includes("pg_stat_progress_cluster")) ?? "";
    expect(read).toContain("a.application_name = 'endue Desk' AND a.usename = current_user");
    expect(read).toContain("starts_with('VACUUM (FULL, VERBOSE) public.orders', a.query)");
    // Then writing the table anew (VACUUM FULL reports in pg_stat_progress_cluster).
    server.progress = [
      "4321",
      "",
      "",
      "",
      "4000",
      "",
      "",
      "",
      "",
      "VACUUM FULL",
      "seq scanning heap",
      "1250",
      "5000",
      "public.orders",
      ...Array(9).fill(""),
    ];
    await acts(m).maintenanceProgress?.(id);
    expect(m.shown()?.maintenance.run.progress).toMatchObject({
      command: "VACUUM FULL",
      phase: "seq scanning heap",
      done: 1250,
      total: 5000,
      relation: "public.orders",
      wait: "",
    });
    // Nothing else changes while it runs.
    await acts(m).maintenanceView?.(id, { options: { full: false } });
    expect(m.view.said.at(-1)).toBe("A run is going on: wait for it, or cancel it.");
    await acts(m).maintenanceRun?.(id);
    expect(m.view.said.at(-1)).toBe("This form's run is still going on.");
    // Cancel: its session is found and signalled on the server.
    await acts(m).maintenanceCancel?.(id);
    expect(m.view.said.at(-1)).toBe(
      "Not cancelled: the run's session was not found on the server; it may have just ended.",
    );
    server.running = true;
    await m.host.command("endue.database.maintenance-cancel");
    expect(server.cancels).toHaveLength(2);
    expect(server.cancels[1]).toMatch(
      /^SELECT pg_catalog\.pg_cancel_backend\(a\.pid\) FROM pg_catalog\.pg_stat_activity a WHERE /u,
    );
    expect(m.view.said.at(-1)).toBe("Cancel sent to the server.");
    expect(m.shown()?.maintenance.run.cancelling).toBe(true);
    held[0]?.finish({ error: "canceling statement due to user request" });
    await running;
    expect(m.shown()?.maintenance.run).toMatchObject({
      status: "cancelled",
      error: "canceling statement due to user request",
      cancelling: false,
    });
    expect(m.shown()?.maintenance.run.after).toMatchObject({ dead: 30000 });
    expect(m.view.said.at(-1)).toBe("VACUUM of public.orders cancelled.");
    expect(server.ran).toEqual([]);
  });
});
