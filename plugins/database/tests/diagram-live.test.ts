// @vitest-environment jsdom
// The ER diagram against a real PostgreSQL (PG-55) on the desk core's sessions, when
// ENDUE_DB_TEST_POSTGRES holds the URI of a scratch database: thirty tables over two schemas with
// foreign keys (one across them, one to itself, one nullable and one unique), read by the schema
// cache; a table's neighbours one and two keys away are the expected tables; the exported SVG
// parses and names every shown table; and the columns' nullability and keys are the database's.
// Skipped without the URI.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClients } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { layoutOf, problemOf, solve } from "../ui/features/diagram/layout.js";
import { graphFromCache, idOf, shownIds, subgraph } from "../ui/features/diagram/model.js";
import { documentOf } from "../ui/features/diagram/svg.js";
import { createRunner } from "../ui/run.js";
import { createSchemaCache } from "../ui/schema-cache/index.js";
import { fromValues } from "../ui/settings.js";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";
import { memoryStore } from "./schema-cache-helpers";

const pgUri = process.env.ENDUE_DB_TEST_POSTGRES;
const A = "t479_a";
const B = "t479_b";

/** Thirty tables: a chain hub ← spoke… in A, a ring of B's tables onto A's hub, and loners. */
function schemaSql() {
  const out = [
    `DROP SCHEMA IF EXISTS ${A}, ${B} CASCADE`,
    `CREATE SCHEMA ${A}`,
    `CREATE SCHEMA ${B}`,
  ];
  out.push(`CREATE TABLE ${A}.hub (id int PRIMARY KEY, name text NOT NULL)`);
  // a1 → hub, a2 → a1, a3 → a2 … a10 → a9: a chain, so depth counts are plain.
  for (let i = 1; i <= 10; i++) {
    const parent = i === 1 ? "hub" : `a${i - 1}`;
    out.push(
      `CREATE TABLE ${A}.a${i} (id int PRIMARY KEY, ${parent}_id int ${i % 2 ? "NOT NULL" : ""} REFERENCES ${A}.${parent} (id), note text)`,
    );
  }
  // b1…b9 each → hub across schemas; b1 also → itself; b2 one-to-one onto hub.
  for (let i = 1; i <= 9; i++)
    out.push(
      `CREATE TABLE ${B}.b${i} (id int PRIMARY KEY, hub_id int ${i === 2 ? "UNIQUE" : ""} REFERENCES ${A}.hub (id)${i === 1 ? `, parent int REFERENCES ${B}.b1 (id)` : ""})`,
    );
  for (let i = 1; i <= 10; i++)
    out.push(`CREATE TABLE ${B}.lone${i} (id int PRIMARY KEY, body text)`);
  out.push(`COMMENT ON TABLE ${A}.hub IS 'Where every key ends'`);
  return out.join(";\n");
}

describe.skipIf(!pgUri)("the ER diagram of a real PostgreSQL", () => {
  const { fields, password } = parseUri(pgUri ?? "postgresql://localhost/x");
  const conn = normalize({ ...fields, id: "c-live", name: "live" });
  const bridge = nodeBridge();
  const runner = createRunner(bridge);
  const settings = fromValues({});
  const executor = createExecutor({
    runner,
    output: inProcessOutput(),
    clients: createClients(runner, () => settings),
    sessions: createSessions(bridge),
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message) => new Error(message),
  });
  const run = async (sql: string) => {
    const done = await executor.execute(conn, sql);
    const failed = done.result.error ?? done.result.statements.find((s) => s.error)?.error;
    if (failed) throw new Error(failed.message);
  };

  beforeAll(() => run(schemaSql()), 60_000);
  afterAll(() => run(`DROP SCHEMA IF EXISTS ${A}, ${B} CASCADE`), 60_000);

  it("draws a table's neighbours and exports an SVG naming every shown table", async () => {
    const cache = createSchemaCache({
      execute: executor.execute,
      store: memoryStore(),
      systemSchemas: () => false,
      changed: () => {},
    });
    await cache.open(conn);
    await cache.choose(conn, [A, B]);
    await cache.settled(conn);
    const view = cache.view(conn);
    if (!view) throw new Error("the cache has no view");
    const graph = graphFromCache(view, [A, B]);
    expect(graph.tables).toHaveLength(30);
    expect(graph.links).toHaveLength(20);

    const named = (ids: Set<string>) => [...ids].map((id) => id.replace("\u0000", ".")).sort();
    const around = (table: string, depth: number) =>
      shownIds(graph, { schemas: [A, B], around: [A, table], depth });
    expect(named(around("a5", 1))).toEqual([`${A}.a4`, `${A}.a5`, `${A}.a6`]);
    expect(named(around("a1", 2))).toEqual(
      [
        `${A}.a1`,
        `${A}.a2`,
        `${A}.a3`,
        `${A}.hub`,
        ...Array.from({ length: 9 }, (_, i) => `${B}.b${i + 1}`),
      ].sort(),
    );
    expect(named(around("hub", 1))).toHaveLength(11);

    const link = (name: string) => graph.links.find((l) => l.from === idOf(B, name));
    expect(link("b2")?.ends).toEqual({ from: "zero-one", to: "zero-one" });
    expect(graph.links.find((l) => l.from === idOf(A, "a1"))?.ends).toEqual({
      from: "many",
      to: "one",
    });
    expect(graph.links.some((l) => l.from === l.to)).toBe(true);
    const hub = graph.tables.find((t) => t.id === idOf(A, "hub"));
    expect(hub?.comment).toBe("Where every key ends");
    expect(hub?.columns.map((c) => [c.name, c.nullable, c.primary])).toEqual([
      ["id", false, true],
      ["name", false, false],
    ]);

    const shown = subgraph(graph, around("a1", 2));
    const made = problemOf(shown, "all", new Map());
    const layout = layoutOf(shown, "all", made, solve(made.problem));
    const svg = documentOf(
      layout,
      {
        background: "#ffffff",
        card: "#ffffff",
        border: "#cccccc",
        head: "#eeeeee",
        text: "#111111",
        key: "#0044cc",
        muted: "#666666",
        line: "#666666",
        font: "monospace",
        size: "12px",
      },
      "live",
    );
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    const names = [...doc.querySelectorAll(".er-name")].map((t) => t.textContent).sort();
    expect(names).toEqual(layout.boxes.map((b) => b.label).sort());
    expect(names).toHaveLength(13);
    for (const label of [`${A}.hub`, `${B}.b9`]) expect(names).toContain(label);
  }, 120_000);
});
