// The plans feature through the plugin's commands (PG-70): EXPLAIN with the options a dialog asks
// for, remembered per connection; a write under ANALYZE rolled back and refused where writes are;
// two plans compared in a panel; the plan copied as text and JSON; the plan tab's view switched.
import { describe, expect, it } from "vitest";
import { DEFAULT_ON } from "../ui/explain/options.js";
import { planText } from "../ui/explain/text.js";
import { mount, SAVED } from "./harness";
import { captured } from "./plans/captured";

const pg17 = captured().find((s) => s.num >= 170000 && s.num < 180000)?.plans ?? {};
const JOIN = "select o.id from orders o join customers c on c.id = o.customer_id";
const LOOPS =
  "select count(*) from orders o join customers c on c.id = o.customer_id where o.status = 'open'";

/** A one-column EXPLAIN's field as it is: the scripted psql (clients.ts) quotes it as --csv does. */
const answer = (plan: unknown) => ({
  rows: [["QUERY PLAN"], [JSON.stringify(plan, null, 2)]],
});
const script = (sql: string) => {
  if (sql === "SHOW server_version_num") return { rows: [["server_version_num"], ["170012"]] };
  if (!sql.startsWith("EXPLAIN")) return {};
  if (sql.includes("update orders")) return answer(pg17.write);
  return answer(sql.includes("status = 'open'") ? pg17.loops : pg17.join);
};
const psql = (m: Awaited<ReturnType<typeof mount>>) =>
  m.clients.spawned.filter((s) => s.command === "psql" && s.args[0] !== "--version");
const explains = (m: Awaited<ReturnType<typeof mount>>) =>
  psql(m).flatMap((s) => s.args.filter((a) => a.startsWith("EXPLAIN")));

async function shop(options: Parameters<typeof mount>[0] = {}) {
  const m = await mount({ store: { connections: SAVED }, script, ...options });
  await m.host.command("endue.database.console", { connection: "Shop" });
  m.view.text = JOIN;
  return m;
}

describe("the plans feature", () => {
  it("explains with the options asked in the dialog and remembers them for the connection", async () => {
    const m = await shop({ dialog: () => ["ANALYZE", "VERBOSE", "WAL", "TIMING"] });
    await m.host.command("endue.database.explain-options");
    const [asked] = m.view.dialogs;
    expect(asked?.type).toBe("explain-options");
    expect(asked?.model).toMatchObject({ connection: "Shop", version: 170012, on: DEFAULT_ON });
    const shown = (asked?.model as { options: Array<{ name: string }> } | undefined)?.options.map(
      (o) => o.name,
    );
    expect(shown).toEqual([
      "ANALYZE",
      "BUFFERS",
      "VERBOSE",
      "SETTINGS",
      "WAL",
      "TIMING",
      "SUMMARY",
      "GENERIC_PLAN",
      "SERIALIZE",
      "MEMORY",
    ]);
    expect(explains(m).at(-1)).toBe(
      `EXPLAIN (ANALYZE, VERBOSE, WAL, TIMING, SUMMARY FALSE, FORMAT JSON) ${JOIN}`,
    );
    expect(m.store["explain:c-prod"]).toEqual(["ANALYZE", "VERBOSE", "WAL", "TIMING"]);
    const tab = m.shown()?.shown?.tabs[0];
    expect(tab).toMatchObject({ label: "Plan (analyzed)", kind: "plan", view: "tree" });
    expect(tab?.plan?.summary?.planning).toBeGreaterThan(0);
    expect(tab?.plan?.marks.map((mark) => mark.kind)).toEqual(["misestimate", "spill"]);

    await m.host.command("endue.database.explain");
    await m.host.command("endue.database.explain-analyze");
    expect(explains(m).slice(-2)).toEqual([
      `EXPLAIN (VERBOSE, FORMAT JSON) ${JOIN}`,
      `EXPLAIN (ANALYZE, VERBOSE, WAL, TIMING, SUMMARY FALSE, FORMAT JSON) ${JOIN}`,
    ]);
    expect(psql(m).filter((s) => s.args.includes("SHOW server_version_num"))).toHaveLength(1);

    m.view.answerDialog = () => undefined;
    await expect(m.host.command("endue.database.explain-options")).rejects.toThrow(
      /Not explained/u,
    );
    expect(explains(m)).toHaveLength(3);
    await m.host.command("endue.database.console", { connection: "Notes" });
    await expect(m.host.command("endue.database.explain-options")).rejects.toThrow(
      /Explain options are PostgreSQL's/u,
    );
  });

  it("rolls a write back under ANALYZE and refuses it on a read-only connection", async () => {
    const write = "update orders set total = total + 1 where id <= 20";
    const m = await shop();
    m.view.text = write;
    await m.host.command("endue.database.explain-options", { on: ["ANALYZE", "BUFFERS", "WAL"] });
    const ran = psql(m).at(-1)?.args ?? [];
    const at = ran.indexOf(
      `EXPLAIN (ANALYZE, BUFFERS, WAL, TIMING FALSE, SUMMARY FALSE, FORMAT JSON) ${write}`,
    );
    expect(at).toBeGreaterThan(0);
    expect(ran.slice(0, at)).toContain("BEGIN");
    expect(ran.slice(at)).toContain("ROLLBACK");
    expect(m.shown()?.shown?.summary).toMatch(/rolled back/u);
    expect(m.shown()?.shown?.tabs[0]?.plan?.summary?.triggers[0]).toMatchObject({
      name: "orders_audit",
      calls: 20,
    });

    const locked = SAVED.map((c) => (c.id === "c-prod" ? { ...c, readOnly: true } : c));
    const r = await mount({ store: { connections: locked }, script });
    await r.host.command("endue.database.console", { connection: "Shop" });
    r.view.text = write;
    await expect(
      r.host.command("endue.database.explain-options", { on: ["ANALYZE"] }),
    ).rejects.toThrow(/read-only/iu);
    expect(explains(r)).toEqual([]);
  });

  it("compares the last two plans of the console in a panel", async () => {
    const m = await shop({ pick: (asked) => asked.items[1]?.id ?? "" });
    await expect(m.host.command("endue.database.compare-plans")).rejects.toThrow(
      /No plan to compare/u,
    );
    await m.host.command("endue.database.explain-analyze");
    await expect(m.host.command("endue.database.compare-plans")).rejects.toThrow(
      /One plan is kept/u,
    );
    m.view.text = LOOPS;
    await m.host.command("endue.database.explain-analyze");
    await m.host.command("endue.database.compare-plans");
    const panel = m.shown();
    expect(panel?.kind).toBe("plans");
    expect(panel?.name).toBe("plans: Shop · compare");
    const state = panel?.plans as {
      before: { sql: string };
      after: { sql: string };
      comparison: { rows: Array<{ changes: string[] }>; changed: number };
    };
    expect(state.before.sql).toBe(JOIN);
    expect(state.after.sql).toBe(LOOPS);
    expect(state.comparison.rows[0]?.changes[0]).toBe("Sort → Aggregate");
    expect(state.comparison.changed).toBeGreaterThan(0);
    expect(m.view.said.at(-1)).toMatch(/^\d+ of \d+ nodes changed\.$/u);

    await m.host.command("endue.database.console", { connection: "Shop" });
    m.view.text = JOIN;
    await m.host.command("endue.database.explain");
    await m.host.command("endue.database.compare-plans");
    expect(m.picks.at(-1)?.title).toBe("Database: compare the last plan with which?");
    expect(m.picks.at(-1)?.items).toHaveLength(2);
    expect((m.shown()?.plans as typeof state | undefined)?.before.sql).toBe(JOIN);
  });

  it("copies the plan as text and as JSON", async () => {
    const m = await shop({ pick: () => "json" });
    await expect(m.host.command("endue.database.copy-plan", { as: "text" })).rejects.toThrow(
      /No plan on screen/u,
    );
    await m.host.command("endue.database.explain-analyze");
    await m.host.command("endue.database.copy-plan", { as: "text" });
    const plan = m.shown()?.shown?.tabs[0]?.plan;
    expect(m.view.copied.at(-1)).toBe(planText(plan as never));
    expect(m.view.copied.at(-1)).toMatch(
      /^Sort {2}\(cost=[\d.]+ rows=2\) \(actual time=[\d.]+ rows=1980 loops=1\)$/mu,
    );
    await m.host.command("endue.database.copy-plan");
    expect(JSON.parse(m.view.copied.at(-1) ?? "")).toEqual(pg17.join);
    expect(m.view.said.at(-1)).toBe("Copied the plan as JSON.");
  });

  it("switches the plan tab between tree, flame and table", async () => {
    const m = await shop({ pick: () => "table" });
    await m.host.command("endue.database.explain-analyze");
    await m.host.command("endue.database.plan-view", { view: "flame" });
    expect(m.shown()?.shown?.tabs[0]?.view).toBe("flame");
    await m.host.command("endue.database.explain-analyze");
    expect(m.shown()?.shown?.tabs[0]?.view).toBe("flame");
    await m.host.command("endue.database.plan-view");
    expect(m.picks.at(-1)?.title).toBe("Database: show the plan as");
    expect(m.shown()?.shown?.tabs[0]?.view).toBe("table");
    await m.app.planView?.("tree");
    expect(m.shown()?.shown?.tabs[0]?.view).toBe("tree");
  });
});
