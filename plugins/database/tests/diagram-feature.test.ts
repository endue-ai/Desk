// The ER diagram through the plugin's commands and actions (PG-55) on the SDK's test host, with a
// PostgreSQL schema cache over the scripted psql (diagram-fixture.ts): the explorer's r on a schema
// (with its filter) and on a table, the neighbours command with a depth, add and remove a table, a
// schema added, the columns, Auto layout, a moved table kept in the store and drawn there after a
// restart, a new table placed without moving the others, and a relation drawn and taken away.
import { describe, expect, it } from "vitest";
import type { Node } from "../ui/explorer.js";
import type { DiagramState } from "../ui/features/diagram/read.js";
import { DIAGRAM_CONNECTION, storeCatalog } from "./diagram-fixture";
import { type Mounted, mount } from "./harness";
import { catalogScript, type PgCatalog } from "./pg-catalog";

type Acts = Record<string, (...args: unknown[]) => Promise<unknown>>;
const acts = (m: Mounted) => m.app as unknown as Acts;
const state = (m: Mounted) => m.shown()?.diagram as DiagramState;
const tables = (m: Mounted) =>
  state(m)
    .layout.boxes.map((b) => b.label)
    .sort();
const box = (m: Mounted, label: string) => state(m).layout.boxes.find((b) => b.label === label);
const row = (kind: string, more: Record<string, string>) =>
  ({
    key: kind,
    kind,
    label: "",
    detail: "",
    level: 1,
    expandable: true,
    expanded: false,
    connection: "c-depot",
    ...more,
  }) as Node;

async function mounted(model: PgCatalog, more: Parameters<typeof mount>[0] = {}) {
  return mount({
    store: { connections: [DIAGRAM_CONNECTION] },
    script: catalogScript(() => model),
    ...more,
  });
}

describe("the ER diagram's commands", () => {
  it("opens, arranges and keeps a diagram through the plugin's commands", async () => {
    const model = storeCatalog();
    const m = await mounted(model, {
      pick: ({ items }) => items.find((i) => i.label === "notes")?.id ?? "",
    });
    // r on a schema with the explorer's filter: the tables it keeps.
    await acts(m).filter?.("order");
    await acts(m).diagram?.(row("schema", { schema: "public" }));
    expect(m.shown()?.name).toBe('er: depot · public matching "order"');
    expect(tables(m)).toEqual(["order_lines", "orders"]);
    await acts(m).filter?.("");
    // r on a table: it and its neighbours one key away.
    await acts(m).diagram?.(row("table", { schema: "public", table: "orders" }));
    expect(m.shown()?.name).toBe("er: depot · public.orders ±1");
    expect(tables(m)).toEqual(["customers", "invoices", "order_lines", "orders"]);
    // Two keys away reaches another schema, and the labels say which.
    await m.host.command("endue.database.er-neighbours", {
      connection: "depot",
      schema: "public",
      table: "orders",
      depth: 2,
    });
    expect(m.shown()?.name).toBe("er: depot · public.orders ±2");
    expect(tables(m)).toContain("sales.leads");
    expect(tables(m)).toHaveLength(6);

    // A whole schema; then keys only, a table removed and added, a schema added.
    await expect(
      m.host.command("endue.database.er-diagram", { connection: "depot", schema: "public" }),
    ).resolves.toEqual({ tables: 7, links: 4 });
    await m.host.command("endue.database.er-columns", { columns: "keys" });
    expect(state(m).layout.mode).toBe("keys");
    expect(box(m, "orders")?.rows.map((c) => c.name)).toEqual(["id", "customer_id"]);
    await m.host.command("endue.database.er-remove-table", { table: "public.notes" });
    expect(tables(m)).not.toContain("notes");
    await m.host.command("endue.database.er-add-table");
    expect(tables(m)).toContain("notes");
    await m.host.command("endue.database.er-add-schema", { schema: "sales" });
    expect(tables(m)).toContain("sales.leads");
    expect(state(m).counts.links).toBe(5);

    // A move is kept; Auto layout lays it out again.
    const id = box(m, "public.audit")?.id as string;
    expect(await acts(m).diagramMoved?.(m.shown()?.id, [[id, 2400, 1600]])).toBe(true);
    await acts(m).diagramFlush?.();
    expect(box(m, "public.audit")).toMatchObject({ x: 2400, y: 1600 });
    const kept = JSON.stringify(Object.entries(m.store).filter(([k]) => k.startsWith("diagram.")));
    expect(kept).toContain('["public","audit",2400,1600]');
    await m.host.command("endue.database.er-arrange");
    expect(box(m, "public.audit")?.x).not.toBe(2400);
    await acts(m).diagramMoved?.(m.shown()?.id, [[id, 2400, 1600]]);
    await acts(m).diagramFlush?.();

    // After a restart the diagram is drawn as it was left, and a new table takes a free place.
    model.public?.tables?.push({ name: "refunds", columns: [["id", "integer", "np"]] });
    if (model.public) model.public.mark = "10.8:800";
    const after = await mounted(model, { store: m.store });
    for (let i = 0; i < 20; i++) {
      await after.host.command("endue.database.er-diagram", {
        connection: "depot",
        schema: "public",
      });
      if (box(after, "public.refunds")) break;
      await after.settle();
    }
    expect(state(after).layout.mode).toBe("keys");
    expect(box(after, "public.audit")).toMatchObject({ x: 2400, y: 1600 });
    const fresh = box(after, "public.refunds");
    expect(fresh).toBeDefined();
    for (const other of state(after).layout.boxes)
      if (other.id !== fresh?.id) {
        const apart =
          (fresh?.x ?? 0) >= other.x + other.w ||
          (fresh?.y ?? 0) >= other.y + other.h ||
          (fresh?.x ?? 0) + (fresh?.w ?? 0) <= other.x ||
          (fresh?.y ?? 0) + (fresh?.h ?? 0) <= other.y;
        expect(apart, other.label).toBe(true);
      }
  });

  it("draws a relation the database does not declare and takes it away", async () => {
    const m = await mounted(storeCatalog());
    await m.host.command("endue.database.er-diagram", { connection: "depot", schema: "public" });
    const drawn = await m.host.command("endue.database.er-relation", {
      from: "audit",
      to: "customers",
      columns: "actor",
    });
    expect(drawn).toBe("audit (actor) → customers (id)");
    const line = state(m).layout.lines.find((l) => l.drawn);
    expect(line?.title).toBe("audit (actor) → customers (id) · not in the database");
    expect(state(m).counts).toMatchObject({ links: 4, drawn: 1 });
    expect(m.view.said.at(-1)).toMatch(/not in the database/u);
    await m.host.command("endue.database.er-remove-relation", { relation: drawn });
    expect(state(m).counts.drawn).toBe(0);
    await expect(m.host.command("endue.database.er-remove-relation")).rejects.toThrow(
      /no drawn relations/u,
    );
  });
});
