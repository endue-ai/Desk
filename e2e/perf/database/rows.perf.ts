// A million-row read in a PostgreSQL console as the person meets it (PG-22, ADR 0352): the first
// rows on screen, the result scrolled page by page to its last row (the median page judged), the
// frame's heap once there (the rows held stay bounded), and the process's CPU while the console then
// sits idle. The page is the max-rows setting's default. Live: skipped without ENDUE_DB_TEST_POSTGRES.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fastest } from "../lib/calibrated";
import { median } from "../lib/stats";
import { calibration, hold } from "./hold";
import { disconnect, live, liveConnection, PREFIX, runIn, server, shownSet, URI } from "./live";

const MILLION = 1_000_000;
const READ = `select g, md5(g::text) as h, now() as at from generate_series(1, ${MILLION}) g`;
const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});
const heapMiB = () => {
  gc();
  return process.memoryUsage().heapUsed / (1024 * 1024);
};

describe.skipIf(!URI)("a million-row read", () => {
  beforeAll(() => server.end());
  afterAll(() => server.end(`application_name = '${PREFIX}'`));

  it("shows its first rows, scrolls to its end, holds a bounded heap and idles", async () => {
    const m = await live(liveConnection("c-perf-rows"));
    await m.host.command("endue.database.console", { connection: "live" });
    // One read to open the session and warm the code, before anything is timed.
    await runIn(m, "select 1");

    let at = calibration();
    const first = await fastest(3, async () => {
      await runIn(m, READ);
      expect(shownSet(m)?.rows.length).toBeGreaterThan(0);
    });
    hold("rows.firstRowsMs", first, at);

    const before = heapMiB();
    at = calibration();
    const started = performance.now();
    const pages: number[] = [];
    while (!shownSet(m)?.window?.done) {
      const page = performance.now();
      await m.app.page({ rows: "next" });
      pages.push(performance.now() - page);
    }
    const scrolled = performance.now() - started;
    expect(shownSet(m)?.window?.known).toBe(MILLION);
    expect(shownSet(m)?.rows.at(-1)?.[0]).toBe(String(MILLION));
    // Judged on the median page: the pace of the scroll, which a burst of load during its 2,000
    // round trips does not move as it moves their sum.
    console.info(`perf-database rows: ${pages.length} pages to the end in ${Math.round(scrolled)} ms`);
    hold("rows.scrollPageMs", median(pages), at);
    hold("rows.heapAfterEndMiB", Math.max(0, heapMiB() - before), at);

    // At rest: the console open on its result, nothing asked of it.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const cpu = process.cpuUsage();
    const rest = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const used = process.cpuUsage(cpu);
    const percent = ((used.user + used.system) / 1000 / (performance.now() - rest)) * 100;
    hold("rows.idleCpuPercent", percent, at);
    await disconnect(m);
  });
});
