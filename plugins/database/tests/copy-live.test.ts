// A console's COPY through standard input or output on a real server (PG-23), through the desk
// core's sessions and its files (core-bridge.ts: the core grants the file a test names, as the
// dialog would). 1,000,000 rows go out to a file and in again, each write and read 1 MiB at most and
// the plugin's heap far below the file's size, and the copy equals the source by EXCEPT ALL both
// ways; a malformed line's error names its line; a cancel mid-COPY out and mid-COPY in leaves the
// console's session working. It runs when ENDUE_DB_TEST_POSTGRES holds a URI of a scratch database.
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalize, parseUri } from "../ui/connections.js";
import { COPY_CHUNK } from "../ui/copy/index.js";
import type { Connection } from "../ui/engines/common.js";
import { sharedCore } from "./core-bridge";
import { type Mounted, mount } from "./harness";
import { liveSessions } from "./live-sessions";
import { realProcs } from "./scripted";
import { messages, run, sessionOf, start } from "./session-helpers";

const uri = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
const { fields, password } = uri ? parseUri(uri) : { fields: {}, password: undefined };
const server = liveSessions(uri, "endue copy");
const LIVE = (uri ? normalize({ ...fields, id: "c-live-copy", name: "live" }) : {}) as Connection;
const ROWS = 1_000_000;
const folder = mkdtempSync(join(tmpdir(), "desk-copy-"));
// What the plugin keeps, not garbage a collection has not reached yet: collected before each look.
setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;
const heap = () => {
  gc();
  return process.memoryUsage().heapUsed;
};

type Watch = { writes: number[]; reads: number[]; heap: number; first?: () => void };

/** The plugin on the real core, its dialogs answering `file`, its fs.* the core's. */
async function live(file: string, watch: Watch): Promise<Mounted> {
  const procs = realProcs(password ? { password } : {});
  const core = sharedCore();
  const peak = () => {
    watch.heap = Math.max(watch.heap, heap());
  };
  const copy = procs.handlers["db.copy"] as (params: { data?: string }) => Promise<unknown>;
  const m = await mount({
    store: { connections: [LIVE] },
    handlers: {
      ...procs.handlers,
      // The test host keeps every call's params: what a chunk carried is dropped once it is sent,
      // so the heap shows what the plugin itself holds.
      "db.copy": async (params) => {
        const done = await copy(params);
        params.data = "";
        return done as never;
      },
      "dialog.save": () => ({ cancelled: false, path: file }),
      "dialog.open": () => ({ cancelled: false, paths: [file] }),
      "fs.write": async (params) => {
        watch.writes.push(params.content.length);
        peak();
        const done = await core.call("fs.write", params);
        params.content = "";
        watch.first?.();
        return done;
      },
      "fs.read": async (params) => {
        const read = (await core.call("fs.read", params)) as { content: string };
        watch.reads.push(read.content.length);
        peak();
        return read;
      },
    },
  });
  procs.attach((event) => m.host.emit(event));
  await m.host.command("endue.database.console", { connection: "live" });
  return m;
}

const fresh = (): Watch => ({ writes: [], reads: [], heap: 0 });
const count = async (sql: string) => Number(await server.admin(sql));
const differences = () =>
  count(
    "SELECT (SELECT count(*) FROM (TABLE copy_src EXCEPT ALL TABLE copy_dst) a) + (SELECT count(*) FROM (TABLE copy_dst EXCEPT ALL TABLE copy_src) b)",
  );
/** A base64 chunk of COPY_CHUNK bytes is this long. */
const MOST = Math.ceil(COPY_CHUNK / 3) * 4;

describe.skipIf(!uri)("a console's COPY on a real server", () => {
  beforeAll(async () => {
    await server.end();
    await server.admin("DROP TABLE IF EXISTS copy_src, copy_dst");
    await server.admin(
      "CREATE TABLE copy_src (id int8, name text, note text, at timestamptz, n numeric)",
    );
    await server.admin(
      `INSERT INTO copy_src SELECT g, md5(g::text), CASE WHEN g % 7 = 0 THEN NULL ELSE E'tab\\there \\\\ "q" ' || repeat('é', g % 5) END, timestamptz '2026-11-22 09:00+00' + g * interval '1 second', g / 7.0 FROM generate_series(1, ${ROWS}) g`,
    );
    await server.admin("CREATE TABLE copy_dst (LIKE copy_src)");
  }, 120_000);
  afterAll(async () => {
    await server.end();
    await server.admin("DROP TABLE IF EXISTS copy_src, copy_dst");
    rmSync(folder, { recursive: true, force: true });
  });

  it("1,000,000 rows out to a file and in again, in bounded chunks, equal both ways", async () => {
    const file = join(folder, "rows.txt");
    const out = fresh();
    const m = await live(file, out);
    const before = heap();
    const began = Date.now();
    await run(m, "copy copy_src to stdout");
    const outMs = Date.now() - began;
    expect(messages(m).join("\n")).toMatch(/COPY: 1,000,000 rows/u);
    const size = statSync(file).size;
    expect(size).toBeGreaterThan(80 * 1024 * 1024);
    expect(Math.max(...out.writes)).toBeLessThanOrEqual(COPY_CHUNK + 64 * 1024);
    const into = fresh();
    const n = await live(file, into);
    const again = Date.now();
    await run(n, "copy copy_dst from stdin");
    const inMs = Date.now() - again;
    expect(messages(n).join("\n")).toMatch(/COPY: 1,000,000 rows/u);
    expect(Math.max(...into.reads)).toBeLessThanOrEqual(MOST);
    expect(await count("SELECT count(*) FROM copy_dst")).toBe(ROWS);
    expect(await differences()).toBe(0);
    const grew = Math.max(out.heap, into.heap) - before;
    // What the plugin held at most stays far below the file it wrote and read.
    expect(grew).toBeLessThan(size / 8);
    console.info(
      `COPY ${ROWS} rows, ${(size / 1048576).toFixed(1)} MiB: out ${outMs} ms in ${out.writes.length} writes, in ${inMs} ms in ${into.reads.length} reads; heap peak +${(grew / 1048576).toFixed(1)} MiB`,
    );
  }, 300_000);

  it("a malformed line's error names its line", async () => {
    const file = join(folder, "bad.txt");
    writeFileSync(file, "1\tone\t\\N\t\\N\t1\n2\ttwo\t\\N\t\\N\t2\nthree\tthree\t\\N\t\\N\t3\n");
    const m = await live(file, fresh());
    await server.admin("TRUNCATE copy_dst");
    await run(m, "copy copy_dst from stdin");
    const error = m
      .shown()
      ?.shown?.tabs.flatMap((t) => t.lines ?? [])
      .map((l) => l.text)
      .join("\n");
    expect(error).toMatch(/bad\.txt, line 3: invalid input syntax for type bigint: "three"/u);
    expect(await count("SELECT count(*) FROM copy_dst")).toBe(0);
  });

  it("a cancel mid-COPY out and mid-COPY in leaves the session working", async () => {
    const file = join(folder, "cancel.txt");
    const watch = fresh();
    const m = await live(file, watch);
    const cancelOnce = () => {
      watch.first = undefined;
      void m.host.command("endue.database.cancel");
    };
    watch.first = cancelOnce;
    await run(m, "copy copy_src to stdout");
    expect(messages(m).join("\n")).toMatch(/Cancelled/u);
    expect(statSync(file).size).toBeLessThan(statSync(join(folder, "rows.txt")).size);
    await run(m, "select 41 + 1");
    const id = sessionOf(m, "copy copy_src to stdout");
    expect(sessionOf(m, "select 41 + 1")).toBe(id);
    expect(m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set?.rows[0]?.[0]).toBe("42");

    const into = fresh();
    const n = await live(join(folder, "rows.txt"), into);
    await server.admin("TRUNCATE copy_dst");
    const going = await start(n, "copy copy_dst from stdin");
    for (let i = 0; i < 500 && into.reads.length < 3; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    await n.host.command("endue.database.cancel");
    await going.done;
    await n.settle();
    expect(messages(n).join("\n")).toMatch(/Cancelled/u);
    await run(n, "select count(*) from copy_dst");
    expect(n.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set?.rows[0]?.[0]).toBe("0");
  }, 120_000);
});
