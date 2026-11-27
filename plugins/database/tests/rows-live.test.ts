// A console's read through a scroll cursor on a real server (PG-22, ADR 0352), through the desk
// core's sessions (core-bridge.ts): a million rows scroll to their end page by page with the rows
// held bounded, the last rows equal the server's, scrolling back reads rows let go again, Count
// every row is exact, the statement is declared once, and a cancel mid-way leaves the session idle
// with no transaction open. Through a pooler (the option on, against the plain server) a read
// outside the person's transaction keeps no cursor, and inside it one does. A session ended
// mid-scroll (pg_terminate_backend) says at once that the rest is gone, and nothing fetches on the
// session that replaces it. A read with bound values declares its cursor with them. It runs when ENDUE_DB_TEST_POSTGRES holds a URI of a scratch database.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import type { Connection, ResultSet } from "../ui/engines/common.js";
import { HOLD_PAGES } from "../ui/rows/window.js";
import { type Mounted, mount } from "./harness";
import { appSessions, liveSessions } from "./live-sessions";
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

// The plugin holds the server's grant, so a lost session opens again on its own (PG-105).
const granted = { "perm.query": () => ({ grants: [{ permission: "db:connect" }] }) as never };

async function live(conn: Connection = LIVE, pick?: () => string): Promise<Mounted> {
  const procs = realProcs(password ? { password } : {});
  const handlers = { ...procs.handlers, ...granted };
  const m = await mount({ store: { connections: [conn] }, handlers, ...(pick ? { pick } : {}) });
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
  afterAll(() => server.end(appSessions));

  it("scrolls a million rows to the end with the rows held bounded; the end equals the server's", async () => {
    const m = await live();
    await run(m, READ);
    expect(set(m).window).toMatchObject({ first: 0, known: PAGE, done: false });
    const gc = (globalThis as { gc?: () => void }).gc;
    m.view.consoles.splice(0, m.view.consoles.length - 1);
    gc?.();
    const heap = process.memoryUsage().heapUsed;
    let most = 0;
    const started = Date.now();
    while (!set(m).window?.done) {
      await m.app.page({ rows: "next" });
      most = Math.max(most, set(m).rows.length);
      // The recording view keeps a copy of every model it drew; only the last is the plugin's.
      m.view.consoles.splice(0, m.view.consoles.length - 1);
      expect(set(m).window?.gone).toBeUndefined();
    }
    const ms = Date.now() - started;
    gc?.();
    const grown = (process.memoryUsage().heapUsed - heap) / (1024 * 1024);
    // The measurement in the PR: how long the scroll took and how far the heap moved.
    console.info(
      `rows-live: ${MILLION} rows in ${ms} ms, at most ${most} held, heap ${grown.toFixed(1)} MiB`,
    );
    expect(most).toBeLessThanOrEqual(HOLD_PAGES * PAGE);
    // Flat: the frame's heap grows by about the rows held, not by the million read (measured
    // after a collection, when the test runs with --expose-gc).
    if (gc) expect(grown).toBeLessThan(200);
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

  it("through a pooler a read outside a transaction keeps no cursor; inside the person's it scrolls", async () => {
    const m = await live({ ...LIVE, pooler: true } as Connection);
    await run(m, READ);
    expect(set(m).rows).toHaveLength(PAGE);
    expect(set(m).window).toBeUndefined();
    const pid = m.shown()?.session?.pid;
    const open = `select (xact_start is null)::text from pg_stat_activity where pid = ${pid}`;
    expect(await server.admin(open)).toBe("true");
    await run(m, "begin");
    await run(m, READ);
    expect(set(m).window).toMatchObject({ known: PAGE, done: false });
    await m.app.page({ rows: "next" });
    expect(set(m).rows.at(-1)).toEqual([String(2 * PAGE), md5(2 * PAGE)]);
    await run(m, "commit");
    expect(await server.admin(open)).toBe("true");
    expect(state(m)).toBe("idle");
    expect(
      rawRunsOf(m.host.calls).some((c) =>
        /START TRANSACTION/u.test(String((c.params as { sql?: string }).sql)),
      ),
    ).toBe(false);
    await done(m);
  }, 60_000);

  it("a session ended mid-scroll says the rest is gone at once; nothing fetches on the new one", async () => {
    const m = await live();
    await run(m, READ);
    await m.app.page({ rows: "next" });
    const pid = m.shown()?.session?.pid;
    await server.admin(`select pg_terminate_backend(${Number(pid)})::text`);
    await until(() => state(m) === "lost");
    expect(set(m).window?.gone).toMatch(/went with its session/u);
    expect(set(m).rows).toHaveLength(2 * PAGE);
    await until(() => state(m) === "idle");
    expect(m.shown()?.session?.pid).not.toBe(pid);
    const before = rawRunsOf(m.host.calls).length;
    await m.app.page({ rows: "next" });
    await m.settle();
    const sent = rawRunsOf(m.host.calls).slice(before);
    expect(
      sent.filter((c) => /FETCH|MOVE/u.test(String((c.params as { sql?: string }).sql))),
    ).toEqual([]);
    await run(m, "select 7");
    expect(set(m).rows).toEqual([["7"]]);
    await done(m);
  }, 60_000);

  it("a read with bound values declares its cursor with them, and scrolls", async () => {
    const m = await live(LIVE, () => "10");
    const text = "select g from generate_series(1, 1000000) g where g > :low";
    m.view.text = text;
    m.view.caret = text.length;
    m.app.edited(text);
    await m.host.command("endue.database.run");
    await m.settle();
    expect(set(m).window).toMatchObject({ known: PAGE, done: false });
    expect(set(m).rows[0]).toEqual(["11"]);
    await m.app.page({ rows: "next" });
    expect(set(m).rows.at(-1)).toEqual([String(2 * PAGE + 10)]);
    await done(m);
  }, 60_000);
});
