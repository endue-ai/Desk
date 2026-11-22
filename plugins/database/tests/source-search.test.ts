// PG-82: the source of routines, views and table parts searched through the plugin's commands and
// actions on the SDK's test host, against the scripted catalog of source-search-fixture.ts: every
// function, procedure, view, materialized view, trigger, policy, check and default that mentions a
// text, with its matching lines, in one schema, one database or every connection; comments as an
// option; a result opening its source at the line; progress and Cancel; an agent's answer; and
// nothing run but catalog reads.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import type { SourceState } from "../ui/features/source-search/controller.js";
import { type Mounted, mount } from "./harness";
import { SEARCH_CONNECTION } from "./search-fixture";
import { FUNCTIONS, type SourceServerOptions, sourceServer } from "./source-search-fixture";

const COPY: Connection = { ...SEARCH_CONNECTION, id: "c-ledger-2", name: "ledger-2" };
const TYPE = "source-search";

async function start(options: SourceServerOptions = {}) {
  const m = await mount({
    store: { connections: [SEARCH_CONNECTION, COPY] },
    script: sourceServer(() => ({}), options),
    pick: () => "yes",
  });
  return m;
}
const acts = (m: Mounted) =>
  m.app as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
const state = (m: Mounted) =>
  [...m.view.consoles].reverse().find((c) => c.model?.kind === TYPE)?.model?.[
    TYPE as never
  ] as unknown as SourceState;
const panelId = (m: Mounted) =>
  [...m.view.consoles].reverse().find((c) => c.model?.kind === TYPE)?.model?.id as string;
const sqls = (m: Mounted) => m.sessions().flat();
const reads = (m: Mounted, what: RegExp) => sqls(m).filter((s) => what.test(s));
const found = (s: SourceState) =>
  (s.run?.objects ?? []).map((o) => [
    o.where,
    o.kind,
    o.schema,
    o.table,
    o.name,
    o.lines.map((l) => l.line),
  ]);

/** The panel of `ledger`, searched for `text` with these fields. */
async function searched(m: Mounted, text: string, fields: Record<string, unknown> = {}) {
  await m.host.command("endue.database.search-source", { connection: "ledger" });
  await acts(m).sourceStart?.(panelId(m), { text, ...fields });
  await m.settle();
  return state(m);
}

const PUBLIC_HITS = [
  ["ledger", "function", "public", "", "order_total(customer integer)", [1, 7]],
  ["ledger", "view", "public", "", "customer_orders", [1, 3]],
  ["ledger", "trigger", "public", "orders", "orders_audit", [1]],
  ["ledger", "policy", "public", "orders", "own_orders", [5]],
  ["ledger", "check", "public", "orders", "orders_customer_check", [1]],
  ["ledger", "default", "public", "orders", "customer", [1]],
];
const SALES_HITS = [["ledger", "materialized view", "sales", "", "invoice_totals", [3]]];

describe("the source search", () => {
  it("finds every routine, view and table part that mentions a column, with its lines", async () => {
    const m = await start();
    const s = await searched(m, "customer");
    expect(m.view.consoles.at(-1)?.model).toMatchObject({ kind: TYPE, name: "source: ledger" });
    expect(s.run?.phase).toBe("done");
    expect(found(s)).toEqual([...PUBLIC_HITS, ...SALES_HITS]);
    const fn = s.run?.objects[0];
    expect(fn?.lines[1]).toEqual({
      line: 7,
      text: "  SELECT sum(total) FROM public.orders o WHERE o.customer = $1",
      ranges: [[50, 58]],
    });
    // A default's and a check's own names are not what is searched for a default: its expression.
    expect(m.view.said.at(-1)).toMatch(/^Found 9 lines in 7 objects of 2 schemas, in .+\.$/u);
    // The bodies: one batch of routines and one of views per schema, with PG-56's reads.
    expect(reads(m, /pg_get_functiondef\(p\.oid\)/u)).toHaveLength(1);
    expect(reads(m, /pg_get_viewdef\(c\.oid, true\)/u)).toHaveLength(2);
    // Read once per read of the schema: a second search asks the server nothing more.
    const before = sqls(m).length;
    await acts(m).sourceStart?.(panelId(m), { text: "orders" });
    await m.settle();
    expect(sqls(m).length).toBe(before);
    expect(state(m).run?.objects.map((o) => o.name)).toContain("close_orders()");
  });

  it("scopes one schema, one database or every connection", async () => {
    const m = await start();
    await m.host.command("endue.database.reload-schema", { connection: "ledger-2" });
    await m.settle();
    const one = await searched(m, "customer", { scope: "schema", schema: "sales" });
    expect(found(one)).toEqual(SALES_HITS);
    const all = await searched(m, "customer", { scope: "all" });
    const copy = (rows: unknown[][]) => rows.map((r) => ["ledger-2", ...r.slice(1)]);
    expect(found(all)).toEqual([
      ...PUBLIC_HITS,
      ...SALES_HITS,
      ...copy(PUBLIC_HITS),
      ...copy(SALES_HITS),
    ]);
  });

  it("searches comments only as an option", async () => {
    const m = await start();
    const s = await searched(m, "customer", { comments: true });
    expect(found(s)).toEqual([
      ["ledger", "function", "public", "", "order_total(customer integer)", [1, 6, 7]],
      ...PUBLIC_HITS.slice(1),
      ["ledger", "comment", "public", "", "customers", [1]],
      ["ledger", "comment", "public", "", "order_total(customer integer)", [1]],
      ...SALES_HITS,
    ]);
    // A column's comment is searched for its text, not its column's name.
    expect(s.run?.objects.some((o) => o.kind === "comment" && o.table === "orders")).toBe(false);
  });

  it("narrows to the chosen kinds", async () => {
    const m = await start();
    const s = await searched(m, "customer", { kinds: ["trigger", "policy"] });
    expect(found(s)).toEqual([PUBLIC_HITS[2], PUBLIC_HITS[3]]);
    // No body was needed, so none was read.
    expect(reads(m, /pg_get_(?:function|view)def/u)).toEqual([]);
  });

  it("opens the source at the line", async () => {
    const m = await start();
    const selected: [number, number][] = [];
    m.view.select = (from: number, to: number) => void selected.push([from, to]);
    await searched(m, "customer");
    await acts(m).sourceOpen?.(panelId(m), 0, 1);
    await m.settle();
    const text = `${(FUNCTIONS["16410"] ?? "").trim()};\n`;
    expect(m.shown()).toMatchObject({ kind: "console", text });
    const from = text.indexOf("  SELECT sum");
    expect(selected.at(-1)).toEqual([from, text.indexOf("\n", from)]);
    expect(m.view.said.at(-1)).toBe("order_total(customer integer): line 7 of its source.");
    // A trigger's DDL, at its line.
    await acts(m).sourceOpen?.(panelId(m), 2, 0);
    await m.settle();
    expect(m.shown()).toMatchObject({
      kind: "ddl",
      text: "CREATE TRIGGER orders_audit AFTER UPDATE OF customer ON public.orders FOR EACH ROW EXECUTE FUNCTION audit_order();\n",
    });
    expect(selected.at(-1)?.[0]).toBe(0);
  });

  it("runs with progress and Cancel, and runs nothing but catalog reads", async () => {
    let m: Mounted | undefined;
    m = await start({
      waits: "sales",
      seen: (sql) => {
        if (sql.includes("'sales'"))
          setTimeout(() => void acts(m as Mounted).sourceCancel?.(panelId(m as Mounted)));
      },
    });
    const s = await searched(m, "customer");
    expect(s.run?.phase).toBe("cancelled");
    expect(found(s)).toEqual(PUBLIC_HITS);
    const drawn = m.view.consoles
      .map((c) => (c.model?.kind === TYPE ? (c.model?.[TYPE as never] as SourceState) : undefined))
      .filter((x) => x?.run?.phase === "running");
    expect(drawn.some((x) => x?.run?.current === "ledger · sales")).toBe(true);
    expect(m.view.said.at(-1)).toMatch(/cancelled after 1 of 2 schemas\.$/u);
    await expect(m.host.command("endue.database.search-source-cancel")).rejects.toThrow(
      "No source search is going on.",
    );
    for (const sql of sqls(m)) expect(sql).not.toMatch(/^\s*(?:UPDATE|INSERT|DELETE|ALTER|CREATE|DROP|COMMENT)\b/iu);
    // Replace is not offered here: a rename goes through its own command.
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"));
    const ids = manifest.contributes.commands
      .map((c: { id: string }) => c.id)
      .filter((id: string) => id.startsWith("endue.database.search-source"));
    expect(ids).toEqual(["endue.database.search-source", "endue.database.search-source-cancel"]);
  });

  it("answers an agent with the objects and their lines, read-only", async () => {
    const m = await start();
    const answer = (await m.host.command("endue.database.search-source", {
      connection: "ledger",
      text: "customer\\s*>",
      regex: true,
    })) as Record<string, unknown>;
    expect(answer).toEqual({
      phase: "done",
      text: "customer\\s*>",
      regex: true,
      scope: "database",
      objects: [
        {
          connection: "ledger",
          kind: "check",
          object: "public.orders.orders_customer_check",
          count: 1,
          lines: [
            {
              line: 1,
              text: 'ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_customer_check" CHECK (customer > 0);',
            },
          ],
        },
      ],
      notes: [],
      summary: expect.stringMatching(/^Found 1 line in 1 object of 2 schemas, in .+\.$/u),
    });
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"));
    const command = manifest.contributes.commands.find(
      (c: { id: string }) => c.id === "endue.database.search-source",
    );
    expect(command).toMatchObject({ agent: true, readOnly: true });
  });
});
