// The SQL parse worker (ADR 0283): the real worker.js in a Node worker thread behind the real client,
// the client over a fake startWorker (one worker, a model sent once, cancel, a worker that stops),
// and the 1 MB budget the ADR states, measured in the worker.

import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { createSqlParser } from "../ui/sql/parse/client.js";
import { loadLibpgQuery } from "../ui/sql/parse/wasm.js";
import { createService } from "../ui/sql/parse/worker.js";
import { MODEL, WASM } from "./pg-parser";

const THREAD = new URL("./parse-worker-thread.mjs", import.meta.url);

/** startWorker for Node: the module in a worker thread, behind a page Worker's surface. */
function threadWorker(url: URL) {
  const thread = new Worker(THREAD, { workerData: { url: url.href } });
  const worker = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as ((event: { message: string }) => void) | null,
    postMessage: (message: unknown) => thread.postMessage(message),
    terminate: () => void thread.terminate(),
  };
  thread.on("message", (data) => worker.onmessage?.({ data }));
  thread.on("error", (error: Error) => worker.onerror?.({ message: error.message }));
  return worker as unknown as globalThis.Worker;
}

type Request = Parameters<ReturnType<typeof createService>["answer"]>[0];

/** startWorker over the worker's service in this thread, recording what crosses. */
async function fakeWorkers() {
  const raw = await loadLibpgQuery(readFileSync(WASM));
  const started: Array<{
    url: string;
    name?: string;
    posted: Request[];
    terminated: boolean;
    fail(message: string): void;
  }> = [];
  const startWorker = (url: URL, options?: { name?: string }) => {
    const service = createService(raw);
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: { message: string }) => void) | null,
      postMessage(message: Request) {
        record.posted.push(message);
        const sent = structuredClone(message);
        setTimeout(() => {
          if (record.terminated) return;
          const reply = service.answer(sent);
          if (reply) worker.onmessage?.({ data: structuredClone(reply) });
        });
      },
      terminate: () => {
        record.terminated = true;
      },
    };
    const record = {
      url: url.href,
      name: options?.name,
      posted: [] as Request[],
      terminated: false,
      fail: (message: string) => worker.onerror?.({ message }),
    };
    started.push(record);
    return worker as unknown as globalThis.Worker;
  };
  return { started, parser: createSqlParser(startWorker) };
}

/** About 1 MB of the statements an application's scripts are made of. */
function megabyte() {
  const unit = [
    "select p.id, p.name, sum(o.total) as total from people p join orders o on o.person = p.id where p.note is not null and o.total > 10 group by p.id, p.name order by total desc limit 10",
    "insert into orders (id, person, total) values (1, 2, 3.5), (2, 3, 4.5) on conflict (id) do update set total = excluded.total",
    "update people set name = 'x', note = 'é😀' where id in (select person from orders where total > 100)",
    "with t as (select person, count(*) c from orders group by person) select * from people join t on t.person = people.id",
    "create table if not exists audit (id bigint generated always as identity primary key, at timestamptz not null default now(), note text)",
    "delete from orders where person not in (select id from people) returning *",
  ].join(";\n");
  const parts: string[] = [];
  let size = 0;
  while (size < 1024 * 1024) {
    parts.push(unit);
    size += unit.length + 2;
  }
  return `${parts.join(";\n")};\n`;
}

/** The fastest of `runs` timings: the budget is for the work, not for a busy machine. */
async function fastest(runs: number, work: () => Promise<unknown>) {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    const at = performance.now();
    await work();
    best = Math.min(best, performance.now() - at);
  }
  return best;
}

/** ADR 0283's budget for 1 MB of SQL in the worker, in milliseconds. */
const BUDGET = { outline: 1000, resolve: 2000 };

describe("parse worker", () => {
  it("parses and resolves in a worker thread, the trees staying there unless asked for", async () => {
    const parser = createSqlParser(threadWorker);
    try {
      const sql = "select name from people;\nselect nope from orders";
      const parsed = await parser.parse(sql);
      expect(parsed.statements.map((s) => s.kind)).toEqual(["SelectStmt", "SelectStmt"]);
      expect(parsed.statements[1]?.tree).toHaveProperty("SelectStmt.fromClause");
      const outline = await parser.outline(sql);
      expect(outline.statements.map((s) => [s.kind, s.tree, s.start.line])).toEqual([
        ["SelectStmt", null, 1],
        ["SelectStmt", null, 2],
      ]);
      const resolved = await parser.resolve(sql, MODEL);
      expect(resolved.statements.every((s) => s.tree === null)).toBe(true);
      expect(resolved.unbound.map((n) => [n.name, n.reason, n.start.line, n.start.column])).toEqual(
        [["nope", "missing", 2, 8]],
      );
      const bad = await parser.outline("select 1; selec 2");
      expect(bad.statements[1]?.error?.message).toBe('syntax error at or near "selec"');
      // A trap (the stack running out) stops that parser; the next request gets a fresh one.
      const deep = `select ${Array(100_000).fill("1").join(" + ")}`;
      await expect(parser.outline(deep)).rejects.toThrow("nests too deeply");
      expect((await parser.outline("select 1; select 2")).statements).toHaveLength(2);
    } finally {
      parser.close();
    }
  }, 30_000);

  it("uses one worker for every request and sends a model once", async () => {
    const { started, parser } = await fakeWorkers();
    const results = await Promise.all([
      parser.outline("select 1"),
      parser.resolve("select id from people", MODEL),
      parser.resolve("select name from people", MODEL),
      parser.resolve("select email from people", MODEL, { searchPath: ["app"] }),
    ]);
    expect(started).toHaveLength(1);
    expect(started[0]?.url).toMatch(/\/ui\/sql\/parse\/worker\.js$/u);
    expect(started[0]?.name).toBe("Database SQL parser");
    expect(started[0]?.posted.map((m) => m.type)).toEqual([
      "parse",
      "model",
      "resolve",
      "resolve",
      "resolve",
    ]);
    expect(results.map((r) => ("unbound" in r ? r.unbound.length : null))).toEqual([null, 0, 0, 0]);
    const other = { schemas: [] };
    await parser.resolve("select 1", other);
    expect(started[0]?.posted.filter((m) => m.type === "model")).toHaveLength(2);
    expect(parser.busy()).toBe(0);
  });

  it("cancel fails what is in flight and the next request starts a fresh worker", async () => {
    const { started, parser } = await fakeWorkers();
    const running = parser.resolve("select 1", MODEL);
    parser.cancel();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(started[0]?.terminated).toBe(true);
    const again = await parser.resolve("select id from people", MODEL);
    expect(again.names).toHaveLength(2);
    expect(started).toHaveLength(2);
    // The new worker never had the model: it is sent again.
    expect(started[1]?.posted.map((m) => m.type)).toEqual(["model", "resolve"]);
    const stopping = parser.outline("select 1");
    started[1]?.fail("The worker stopped.");
    await expect(stopping).rejects.toThrow("The worker stopped.");
    expect((await parser.outline("select 2")).statements).toHaveLength(1);
    expect(started).toHaveLength(3);
  });

  it("parses and resolves 1 MB of SQL in the worker within the budget", async () => {
    const parser = createSqlParser(threadWorker);
    try {
      const sql = megabyte();
      expect(new TextEncoder().encode(sql).length).toBeGreaterThanOrEqual(1024 * 1024);
      const first = await parser.resolve(sql, MODEL);
      expect(first.statements.length).toBeGreaterThan(8000);
      expect(first.statements.every((s) => s.kind)).toBe(true);
      // Only the aggregates and now(), in pg_catalog, which the model does not hold.
      expect(new Set(first.unbound.map((n) => `${n.kind} ${n.name} ${n.reason}`))).toEqual(
        new Set(["function sum unread", "function count unread", "function now unread"]),
      );
      const outline = await fastest(3, () => parser.outline(sql));
      const resolve = await fastest(3, () => parser.resolve(sql, MODEL));
      console.info(
        `1 MB of SQL in the worker: outline ${outline.toFixed(0)} ms, resolve ${resolve.toFixed(0)} ms`,
      );
      expect(outline).toBeLessThan(BUDGET.outline);
      expect(resolve).toBeLessThan(BUDGET.resolve);
    } finally {
      parser.close();
    }
  }, 60_000);
});
