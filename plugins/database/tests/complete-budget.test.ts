// Completion on a 1 MB script stays inside a frame (PG-31, ADR 0327): after the problems check has
// read the script once, a completion at a caret parses the statement there alone and replays what
// the statements before it did, so its cost is the statement's, not the script's. Measured in the
// worker's service, and across the real parse worker in a Node worker thread, as the console asks.
import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { createSqlParser } from "../ui/sql/parse/client.js";
import { createService } from "../ui/sql/parse/worker.js";
import { COMPLETE_MODEL } from "./complete-fixture";
import { loadRaw } from "./problems-fixture";

/** startWorker for Node: the module in a worker thread, behind a page Worker's surface. */
function threadWorker(url: URL) {
  const thread = new Worker(new URL("./parse-worker-thread.mjs", import.meta.url), {
    workerData: { url: url.href },
  });
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

const unit = (n: number) =>
  [
    `select o.id, c.name, sum(i.qty) from orders o join customers c on c.id = o.customer_id join order_items i on i.order_id = o.id where o.total > ${n} group by o.id, c.name`,
    `insert into orders (customer_id, total, note) values (${n}, 2.5, 'x')`,
    `update customers set name = 'y' where id in (select customer_id from orders where total > ${n})`,
    `create temp table t${n} (a int)`,
  ].join(";\n");

/** A script of at least 1 MB, and the statement the caret ends it in. */
function script() {
  let text = "";
  for (let n = 0; text.length < 1024 * 1024; n++) text += `${unit(n)};\n`;
  const tail = "select * from orders o join ";
  return { text: `${text}${tail}`, from: text.length, tail };
}

const best = (times: number[]) => Math.min(...times);

describe("completion on a 1 MB script", () => {
  it("costs the statement at the caret, inside a frame, in the worker and across it", async () => {
    const { text, from, tail } = script();
    expect(text.length).toBeGreaterThan(1024 * 1024);
    const service = createService(await loadRaw());
    service.answer({ type: "model", key: 1, model: COMPLETE_MODEL });
    service.answer({ id: 1, type: "check", doc: "big", sql: text, model: 1 } as never);
    const ask = (id: number) =>
      service.answer({
        id,
        type: "complete",
        doc: "big",
        sql: tail,
        caret: tail.length,
        offset: from,
        model: 1,
      } as never) as { result: { items: Array<{ kind: string }> } };
    const inWorker: number[] = [];
    for (let i = 0; i < 20; i++) {
      const at = performance.now();
      const reply = ask(10 + i);
      inWorker.push(performance.now() - at);
      expect(reply.result.items[0]?.kind).toBe("join");
    }

    const parser = createSqlParser(threadWorker);
    try {
      await parser.check(text, COMPLETE_MODEL, { doc: "big", syntax: true, names: true });
      const across: number[] = [];
      for (let i = 0; i < 20; i++) {
        const at = performance.now();
        const found = await parser.complete(tail, COMPLETE_MODEL, {
          doc: "big",
          caret: tail.length,
          offset: from,
        });
        across.push(performance.now() - at);
        expect(found.items[0]?.kind).toBe("join");
      }
      console.log(
        `completion, 1 MB script: ${JSON.stringify({ inWorker: best(inWorker), across: best(across) })}`,
      );
      expect(best(inWorker)).toBeLessThan(16);
      expect(best(across)).toBeLessThan(16);
    } finally {
      parser.close();
    }
  }, 120_000);
});
