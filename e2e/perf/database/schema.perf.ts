// A schema of 10,000 tables (PG-06, ADR 0285): the explorer opened down to its Tables folder with
// nothing kept (the schema read from the server and the 10,000 rows listed), then opened again in a
// new start from what the store kept; completion over that schema at a caret (a table's name and a
// join from a foreign key) in the parse worker's service, and the problems of a script naming its
// tables, after the model of 10,000 tables is handed to the worker. Live: skipped without
// ENDUE_DB_TEST_POSTGRES; the tables are made once and dropped after.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Mounted } from "../../../plugins/database/tests/harness";
import { loadRaw } from "../../../plugins/database/tests/problems-fixture";
import { problemModel } from "../../../plugins/database/ui/diagnose/model.js";
import type { Node } from "../../../plugins/database/ui/explorer.js";
import { createService } from "../../../plugins/database/ui/sql/parse/worker.js";
import { cpuClock, fastest } from "../lib/calibrated";
import { calibration, hold, until } from "./hold";
import { live, liveConnection, PREFIX, server, URI } from "./live";
import { liveCache } from "./live-cache";
import { dropTables, seedTables, TABLES, tableName } from "./seed";

const CONN = liveConnection("c-perf-schema");
const tree = (m: Mounted) => m.view.trees.at(-1) ?? [];
const row = (m: Mounted, label: string, under?: Node) =>
  tree(m).find((r) => r.label === label && (!under || r.key.startsWith(`${under.key}\u0000`)));
const own = URI ? new URL(URI).pathname.slice(1) : "";

/** Open the explorer down to the public schema's Tables folder and wait for its last table. */
async function openTables(m: Mounted) {
  let at: Node | undefined;
  for (const label of ["live", own, "public", "Tables"]) {
    const under = at;
    await until(() => row(m, label, under));
    at = row(m, label, under) as Node;
    if (!at.expanded) m.app.toggle(at, true);
  }
  await until(() => row(m, tableName(TABLES), at));
  return tree(m).filter((r) => r.kind === "table" && r.label.startsWith("perf_t")).length;
}

describe.skipIf(!URI)("a schema of 10,000 tables", () => {
  beforeAll(async () => {
    await server.end();
    await seedTables();
  });
  afterAll(async () => {
    await server.end(`application_name = '${PREFIX}'`);
    if (!process.env.PERF_KEEP) await dropTables();
  });

  it("opens in the explorer cold and from the store", async () => {
    let kept: Record<string, unknown> = {};
    let at = calibration();
    const cold = await fastest(3, async () => {
      const begun = performance.now();
      const m = await live(CONN);
      expect(await openTables(m)).toBe(TABLES);
      const ms = performance.now() - begun;
      kept = m.store;
      await m.host.command("endue.database.disconnect", { connection: "live" });
      return ms;
    });
    hold("schema.explorerColdMs", cold, at);

    at = calibration();
    const again = await fastest(3, async () => {
      const begun = performance.now();
      const next = await live(CONN, {}, kept);
      expect(await openTables(next)).toBe(TABLES);
      const ms = performance.now() - begun;
      await next.host.command("endue.database.disconnect", { connection: "live" });
      return ms;
    });
    hold("schema.explorerKeptMs", again, at);
  });

  it("completes and checks over the schema in the worker", async () => {
    const cache = liveCache();
    await cache.open(CONN);
    await cache.settled(CONN);
    const model = problemModel(CONN.id, cache.view(CONN) as never);
    expect(
      model?.schemas.find((s) => s.name === "public")?.relations?.length,
    ).toBeGreaterThanOrEqual(TABLES);
    const service = createService(await loadRaw());

    let at = calibration(cpuClock);
    const handed = await fastest(
      3,
      (run) => service.answer({ type: "model", key: 10 + run, model } as never),
      cpuClock,
    );
    hold("schema.modelMs", handed, at);

    let id = 0;
    const complete = (sql: string) => {
      const caret = sql.length;
      const reply = service.answer({
        id: ++id,
        type: "complete",
        doc: "c",
        sql,
        caret,
        offset: 0,
        model: 10,
        searchPath: ["public"],
        user: "",
      } as never) as { result: { items: Array<{ kind: string; label: string }> } };
      return reply.result.items;
    };
    complete("select 1");
    at = calibration(cpuClock);
    const named = await fastest(
      10,
      () => expect(complete("select * from perf_t0999").length).toBeGreaterThan(0),
      cpuClock,
    );
    hold("schema.completeNameMs", named, at);
    at = calibration(cpuClock);
    const joined = await fastest(
      10,
      () =>
        expect(
          complete(`select * from ${tableName(5000)} t join `).some((i) => i.kind === "join"),
        ).toBe(true),
      cpuClock,
    );
    hold("schema.completeJoinMs", joined, at);

    const script = Array.from(
      { length: 2000 },
      (_, i) =>
        `select id, name, total from ${tableName(((i * 7) % TABLES) + 1)} where ref > ${i};`,
    ).join("\n");
    at = calibration(cpuClock);
    const checked = await fastest(
      3,
      (run) => {
        const done = service.answer({
          id: ++id,
          type: "check",
          doc: `p${run}`,
          sql: script,
          model: 10,
          syntax: true,
          names: true,
        } as never) as { result: { problems: unknown[] } };
        expect(done.result.problems).toEqual([]);
      },
      cpuClock,
    );
    hold("schema.problemsMs", checked, at);
  });
});
