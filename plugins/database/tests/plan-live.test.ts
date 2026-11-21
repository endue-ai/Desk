// Query plans from a real PostgreSQL through the plugin's commands (PG-70), when
// ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database (as in live.test.ts): a join the
// planner misestimates, a write under ANALYZE that leaves the table as it was, BUFFERS and WAL
// read from the server, and the options the server's version has.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import { flatten } from "../ui/explain/node.js";
import { mount } from "./harness";
import { realProcs } from "./scripted";

const uri = process.env.ENDUE_DB_TEST_POSTGRES;

const SETUP = `drop table if exists plan_orders, plan_customers, plan_audit cascade;
create table plan_customers (id int primary key, region text not null, tier int not null);
insert into plan_customers select g, case when g % 100 = 0 then 'north' else 'south' end, g % 5 from generate_series(1, 2000) g;
create table plan_orders (id int primary key, customer_id int not null references plan_customers (id), total numeric not null);
insert into plan_orders select g, 1 + (g % 2000), (g % 1000) / 10.0 from generate_series(1, 60000) g;
create table plan_audit (id serial primary key, what text not null);
create or replace function plan_log() returns trigger language plpgsql as $$ begin insert into plan_audit (what) values ('order ' || new.id); return new; end $$;
create trigger plan_orders_audit after update on plan_orders for each row execute function plan_log();
analyze plan_customers;
analyze plan_orders`;
const JOIN =
  "select o.id, c.region from plan_orders o join plan_customers c on c.id = o.customer_id where (c.id % 3) = 0 order by o.total";
const WRITE = "update plan_orders set total = total + 1 where id <= 20";

describe.skipIf(!uri)("plans from a real PostgreSQL", () => {
  let m: Awaited<ReturnType<typeof mount>>;
  /** Run SQL in the console and give back the first cell of the last result. */
  const value = async (sql: string) => {
    m.view.text = sql;
    await m.host.command("endue.database.run");
    return m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set?.rows[0]?.[0];
  };

  beforeAll(async () => {
    const { fields, password } = parseUri(uri ?? "");
    const conn = normalize({ ...fields, id: "c-plans", name: "Plans" });
    const procs = realProcs(password ? { password } : {});
    m = await mount({
      store: { connections: [conn] },
      handlers: procs.handlers,
      pick: () => "yes",
    });
    procs.attach((event) => m.host.emit(event));
    await m.host.command("endue.database.console", { connection: "Plans" });
    m.view.text = SETUP;
    await m.host.command("endue.database.run-all");
  });
  afterAll(async () => {
    if (m) {
      m.view.text = "drop table if exists plan_orders, plan_customers, plan_audit cascade";
      await m.host.command("endue.database.run-all").catch(() => {});
    }
  });

  it("plans a join the planner misestimates, with its buffers, and offers the server's options", async () => {
    const version = Number(await value("show server_version_num"));
    m.view.answerDialog = () => ["ANALYZE", "BUFFERS", "VERBOSE", "SETTINGS", "TIMING", "SUMMARY"];
    m.view.text = JOIN;
    await m.host.command("endue.database.explain-options");
    const asked = m.view.dialogs.at(-1)?.model as {
      version: number;
      options: Array<{ name: string }>;
    };
    expect(asked.version).toBe(version);
    expect(asked.options.map((o) => o.name)).toContain("WAL");
    if (version >= 170000) expect(asked.options.map((o) => o.name)).toContain("SERIALIZE");
    const plan = m.shown()?.shown?.tabs[0]?.plan;
    if (!plan) throw new Error("no plan");
    const s = plan.summary;
    expect(s?.planning).toBeGreaterThan(0);
    expect(s?.execution).toBeGreaterThan(0);
    expect((s?.buffers?.sharedHit ?? 0) + (s?.buffers?.sharedRead ?? 0)).toBeGreaterThan(0);
    const nodes = flatten(plan).map(({ node }) => node);
    const customers = nodes.find((n) => /on public\.plan_customers c/u.test(n.label));
    expect(customers?.actualRows).toBe(666);
    expect(customers?.marks.map((mark) => mark.text)).toContain("67× more rows than estimated");
    expect(nodes.every((n) => n.ownTime !== null && n.ownTime >= 0)).toBe(true);
  });

  it("rolls a write under ANALYZE back: the table and its trigger's table are as they were", async () => {
    const before = await value("select sum(total)::text from plan_orders where id <= 20");
    m.view.text = WRITE;
    await m.host.command("endue.database.explain-options", {
      on: ["ANALYZE", "BUFFERS", "WAL", "TIMING"],
    });
    const plan = m.shown()?.shown?.tabs[0]?.plan;
    expect(m.shown()?.shown?.summary).toMatch(/rolled back/u);
    expect(plan?.label).toBe("Update on plan_orders");
    expect(plan?.summary?.wal?.records).toBeGreaterThan(0);
    expect(plan?.summary?.buffers?.sharedHit).toBeGreaterThan(0);
    expect(plan?.summary?.triggers).toEqual([
      { name: "plan_orders_audit", relation: "plan_orders", time: expect.any(Number), calls: 20 },
    ]);
    expect(await value("select sum(total)::text from plan_orders where id <= 20")).toBe(before);
    expect(await value("select count(*) from plan_audit")).toBe("0");
  });
});
