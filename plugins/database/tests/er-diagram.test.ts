// The ER diagram (item 9 of #540, PG-55): tables, columns and foreign keys from each engine's
// queries, laid out without overlaps with a line per link; and the diagram of a real SQLite database
// through the plugin's command, nullability read from the engine.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { compareVersions, parseVersion } from "../ui/clients.js";
import { normalize } from "../ui/connections.js";
import { layoutOf, problemOf, solve } from "../ui/features/diagram/layout.js";
import { graphFromRows } from "../ui/features/diagram/model.js";
import type { DiagramState } from "../ui/features/diagram/read.js";
import { diagramOf, diagramQueries } from "../ui/schema/diagram.js";
import { mount } from "./harness";
import { clientVersion } from "./node-bridge";
import { realProcs } from "./scripted";

const columns = [
  ["orders", "id", "integer", "YES"],
  ["orders", "customer_id", "integer", "NO"],
  ["customers", "id", "integer", "YES"],
  ["customers", "name", "text", "NO"],
  ["lines", "order_id", "integer", "YES"],
  ["lines", "no", "integer", "YES"],
  ["notes", "body", "text", "NO"],
];
const keys = [
  ["orders", "orders_customer_fk", "customer_id", "customers", "id"],
  ["lines", "lines_order_fk", "order_id", "orders", "id"],
  ["lines", "elsewhere_fk", "x", "not_here", "y"],
];

describe("the ER diagram", () => {
  it("reads tables, columns and the foreign keys between them", () => {
    const diagram = diagramOf(columns, keys);
    expect(diagram.tables.map((t) => t.name)).toEqual(["orders", "customers", "lines", "notes"]);
    expect(diagram.tables[0]?.columns[0]).toEqual({ name: "id", type: "integer", key: true });
    expect(diagram.links).toEqual([
      {
        name: "orders_customer_fk",
        from: "orders",
        fromColumns: "customer_id",
        to: "customers",
        toColumns: "id",
      },
      {
        name: "lines_order_fk",
        from: "lines",
        fromColumns: "order_id",
        to: "orders",
        toColumns: "id",
      },
    ]);
    for (const engine of ["postgresql", "mysql", "sqlite"] as const)
      expect(diagramQueries(engine, "it's")).toHaveLength(2);
    expect(diagramQueries("postgresql", "it's")[1]).toContain("n.nspname = 'it''s'");
  });

  it("lays the tables out without overlaps and routes each link", () => {
    const graph = graphFromRows("main", diagramOf(columns, keys));
    const made = problemOf(graph, "all", new Map());
    const placed = layoutOf(graph, "all", made, solve(made.problem));
    for (const a of placed.boxes)
      for (const b of placed.boxes) {
        if (a === b) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${a.name} and ${b.name}`).toBe(true);
      }
    expect(placed.lines).toHaveLength(2);
    for (const { points } of placed.lines) expect(points.length).toBeGreaterThanOrEqual(4);
    expect(placed.bounds.w).toBeGreaterThan(0);
  });
});

const line = process.platform === "win32" ? undefined : clientVersion("sqlite3");
const usable = line && compareVersions(parseVersion(line)?.version ?? "0", "3.37") >= 0;
const scratch = mkdtempSync(join(tmpdir(), "endue-db-er-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe.skipIf(!usable)("the ER diagram of a real SQLite database", () => {
  it("draws its tables and foreign keys through the plugin's command", async () => {
    const file = join(scratch, "er.db");
    const conn = normalize({ engine: "sqlite", file, id: "c-er", name: "Shop" });
    const procs = realProcs();
    const m = await mount({
      store: { connections: [conn] },
      handlers: procs.handlers,
      pick: () => "yes",
    });
    procs.attach((event) => m.host.emit(event));
    await m.host.command("endue.database.console", { connection: "Shop" });
    m.view.text =
      "create table customers (id integer primary key, name text);\n" +
      "create table orders (id integer primary key, customer_id integer references customers (id));";
    await m.host.command("endue.database.run-all");
    const drawn = await m.host.command("endue.database.er-diagram", {
      connection: "Shop",
      schema: "main",
    });
    expect(drawn).toEqual({ tables: 2, links: 1 });
    const shown = m.shown();
    expect(shown?.kind).toBe("diagram");
    const { layout } = (shown?.diagram ?? {}) as DiagramState;
    expect(layout.lines[0]?.title).toBe("orders (customer_id) → customers (id) · fk0");
    const orders = layout.boxes.find((b) => b.name === "orders");
    expect(orders?.rows.map((c) => [c.name, c.nullable, c.primary, c.foreign])).toEqual([
      ["id", false, true, false],
      ["customer_id", true, false, true],
    ]);
  });
});
