// A console's read through a scroll cursor on a real server (PG-22, ADR 0352), through the desk
// core's sessions (core-bridge.ts): a million rows scroll to their end page by page with the rows
// held bounded, the last rows equal the server's, scrolling back reads rows let go again, Count
// every row is exact, the statement is declared once, and a cancel mid-way leaves the session idle
// with no transaction open. It runs when ENDUE_DB_TEST_POSTGRES holds a URI of a scratch database.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection, ResultSet } from "../ui/engines/common.js";
import { HOLD_PAGES } from "../ui/rows/window.js";
import { type Mounted, mount } from "./harness";
import { liveSessions } from "./live-sessions";
import { rawRunsOf } from "./runs-of";
import { realProcs } from "./scripted";
import { run, state } from "./session-helpers";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const { fields, password } = uri ? parseUri(uri) : { fields: {}, password: undefined };
const server = liveSessions(uri, "endue rows");
const LIVE = (uri ? normalize({ ...fields, id: "c-live-rows", name: "live" }) : {}) as Connection;
const PAGE = 10_000;
const MILLION = 1_000_000;
const READ = "select g, md5(g::text) as h from generate_series(1, 1000000) g";

async function live(): Promise<Mounted> {
  const procs = realProcs(password ? { password } : {});
  const m = await mount({ store: { connections: [LIVE] }, handlers: procs.handlers });
  procs.attach((event) => m.host.emit(event));
  await m.host.call(
    "settings.set",
    { key: "endue.database.max-rows", value: PAGE },
    "endue.database",
  );
  await m.settle();
  await m.host.command("endue.database.console", { connection: "live" });
  return m;
}
const set = (m: Mounted) => m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set as ResultSet;
const md5 = (n: number) => createHash("md5").update(String(n)).digest("hex");
const until = async (test: () => Promise<boolean> | boolean, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const done = (m: Mounted) => m.host.command("endue.database.disconnect", { connection: "live" });

describe.skipIf(!uri)("a console's read through a cursor on a real server", () => {
  beforeAll(() => server.end());
  afterAll(() => server.end("application_name = 'endue Desk'"));

  it("scrolls a million rows to the end with the rows held bounded; the end equals the server's", async () => {
    const m = await live();
    await run(m, READ);
    expect(set(m).window).toMatchObject({ first: 0, known: PAGE, done: false });
    const heap = process.memoryUsage().heapUsed;
    let most = 0;
    const started = Date.now();
    while (!set(m).window?.done) {
      await m.app.page({ rows: "next" });
      most = Math.max(most, set(m).rows.length);
      expect(set(m).window?.gone).toBeUndefined();
    }
    const ms = Date.now() - started;
    const grown = (process.memoryUsage().heapUsed - heap) / (1024 * 1024);
    // The measurement in the PR: how long the scroll took and how far the heap moved.
    console.info(
      `rows-live: ${MILLION} rows in ${ms} ms, at most ${most} held, heap ${grown.toFixed(1)} MiB`,
    );
    expect(most).toBeLessThanOrEqual(HOLD_PAGES * PAGE);
    const w = set(m).window;
    expect(w).toMatchObject({ known: MILLION, done: true });
    expect(set(m).rows.at(-1)).toEqual([String(MILLION), md5(MILLION)]);
    expect(await server.admin(`select md5('${MILLION}')`)).toBe(md5(MILLION));
    expect(w?.first).toBe(MILLION - set(m).rows.length);
    // Rows let go come back from the cursor, not from running the read again.
    await m.app.page({ rows: "back" });
    const first = set(m).window?.first ?? 0;
    expect(set(m).rows[0]).toEqual([String(first + 1), md5(first + 1)]);
    const declared = rawRunsOf(m.host.calls).filter((c) =>
      String((c.params as { sql?: string }).sql ?? "").startsWith("DECLARE"),
    );
    expect(declared).toHaveLength(1);
    expect(state(m)).toBe("idle");
    await done(m);
  }, 180_000);

  it("Count every row is exact and keeps the rows held", async () => {
    const m = await live();
    await run(m, READ);
    expect(await m.host.command("endue.database.count-result-rows")).toBe("1,000,000 rows");
    expect(set(m).rows).toHaveLength(PAGE);
    await m.app.page({ rows: "next" });
    expect(set(m).rows.at(-1)).toEqual([String(2 * PAGE), md5(2 * PAGE)]);
    await done(m);
  }, 60_000);

  it("a cancel mid-way frees the cursor: the session is idle, no transaction open, and runs again", async () => {
    const m = await live();
    await run(
      m,
      "select g, case when g > 10000 then pg_sleep(0.01) end as slept from generate_series(1, 1000000) g",
    );
    const pid = m.shown()?.session?.pid;
    expect(pid).toBeGreaterThan(0);
    const going = m.app.page({ rows: "next" });
    const active = `select count(*) from pg_stat_activity where pid = ${pid} and state = 'active' and query like 'FETCH%'`;
    await until(async () => (await server.admin(active)) === "1");
    await m.host.command("endue.database.cancel");
    await going;
    expect(m.view.said.at(-1)).toMatch(/cannot be read/u);
    expect(set(m).rows).toHaveLength(PAGE);
    const idle = `select state || ':' || (backend_xmin is null) || ':' || (xact_start is null) from pg_stat_activity where pid = ${pid}`;
    await until(async () => (await server.admin(idle)) === "idle:true:true");
    await run(m, "select 7");
    expect(set(m).rows).toEqual([["7"]]);
    expect(state(m)).toBe("idle");
    await done(m);
  }, 60_000);
});
