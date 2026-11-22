// A table of 1,000 columns opened as a table view (the explorer's open, `endue.database.open-table`):
// from the command to its first page of rows held, its columns read from the server. The grid's
// drawing of such a result is grid.perf.ts's. Live: skipped without ENDUE_DB_TEST_POSTGRES; the
// table is made and dropped here.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fastest } from "../lib/calibrated";
import { calibration, hold } from "./hold";
import { disconnect, live, liveConnection, PREFIX, server, shownSet, URI } from "./live";
import { COLUMNS, dropWide, seedWide } from "./seed";

describe.skipIf(!URI)("a table of 1,000 columns", () => {
  beforeAll(async () => {
    await server.end();
    await seedWide();
  });
  afterAll(async () => {
    await server.end(`application_name = '${PREFIX}'`);
    await dropWide();
  });

  it("opens as a table view", async () => {
    const m = await live(liveConnection("c-perf-wide"));
    const open = (n: number) =>
      m.host.command("endue.database.open-table", {
        connection: "live",
        schema: "public",
        table: `perf_wide_${n}`,
      });
    // The session opened and the code warm before anything is timed; each run opens a table not
    // open yet.
    await open(1);
    expect(shownSet(m)?.columns).toHaveLength(COLUMNS);
    const at = calibration();
    const opened = await fastest(3, async (run) => {
      await open(run + 2);
      expect(shownSet(m)?.columns).toHaveLength(COLUMNS);
      expect(shownSet(m)?.rows.length).toBeGreaterThan(0);
    });
    hold("wide.tableViewMs", opened, at);
    await disconnect(m);
  });
});
