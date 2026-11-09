// The result worker (#38): what a client printed is decoded and parsed in output-worker.js, and the
// frame sends it the runner's bytes, never text it decoded itself.
import { MessageChannel } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import type { Invocation, Outcome } from "../ui/engines/common.js";
import { createExecutor } from "../ui/execute.js";
import { createOutputReader } from "../ui/output-client.js";
import { answer } from "../ui/output-worker.js";
import { createRunner } from "../ui/run.js";
import { fromValues } from "../ui/settings.js";
import { split } from "../ui/sql/split.js";

const NONCE = "abcdefghijkl";
/** What psql prints for `SELECT id, name FROM t` over `rows` rows, then its marker line. */
const psqlCsv = (rows = 5000) =>
  [
    "id,name",
    ...Array.from({ length: rows }, (_, i) => `${i},"row ${i}, quoted"`),
    `@@endue:${NONCE}:0 ${rows}`,
    "",
  ].join("\n");
const reading = (maxRows: number): Invocation =>
  ({
    statements: split("SELECT id, name FROM t", "postgresql"),
    nonce: NONCE,
    maxRows,
  }) as unknown as Invocation;
/** The plan of that read, as the runner takes it. */
const psqlRun = (maxRows: number): Invocation => ({
  ...reading(maxRows),
  command: "psql",
  args: [],
  env: {},
  stopAfter: 0,
});
const flags = { code: 0, signal: null, stopped: false, cancelled: false, timedOut: false };
const plain = (stdout: string): Outcome => ({
  ...flags,
  overflow: false,
  ms: 1,
  stdout,
  stderr: "",
});

/** A bridge that runs one psql: spawn answers, then the output arrives in 8 KiB chunks and exits. */
function onePsql(stdout: string) {
  let emit: (event: unknown) => void = () => {};
  return {
    call: async (method: string) => {
      if (method !== "proc.spawn") return {};
      setTimeout(() => {
        for (let at = 0; at < stdout.length; at += 8192)
          emit({
            event: "proc.output",
            data: {
              procId: "p1",
              stream: "stdout",
              data: stdout.slice(at, at + 8192),
              encoding: "utf8",
            },
          });
        emit({ event: "proc.exit", data: { procId: "p1", code: 0, signal: null } });
      }, 0);
      return { procId: "p1" };
    },
    onEvent: (handler: (event: unknown) => void) => {
      emit = handler;
      return () => {};
    },
  };
}

/** A stand-in for startWorker that runs output-worker.js's answer a turn later and keeps what came. */
function fakeWorkers() {
  const posted: unknown[] = [];
  const terminated: number[] = [];
  let hold = false;
  const start = (url: URL) => {
    const index = posted.length;
    const worker = {
      url: url.href,
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: { message: string }) => void) | null,
      postMessage(message: Parameters<typeof answer>[0]) {
        posted.push(message);
        if (!hold) setTimeout(() => worker.onmessage?.({ data: answer(message) }), 0);
      },
      terminate: () => terminated.push(index),
    };
    starts.push(worker.url);
    return worker as unknown as Worker;
  };
  const starts: string[] = [];
  return { start, posted, terminated, starts, holdReplies: () => (hold = true) };
}

describe("the database result worker", () => {
  it("reads psql's output from bytes, across a real message boundary, cut to maxRows", async () => {
    const { port1, port2 } = new MessageChannel();
    try {
      const reply = new Promise<ReturnType<typeof answer>>((done) => port1.once("message", done));
      const bytes = new TextEncoder().encode(psqlCsv());
      const outcome = { ...plain(""), stdout: bytes, stderr: new Uint8Array() };
      port2.postMessage(
        answer({ id: 7, engine: "postgresql", outcome, invocation: reading(100), timeoutMs: 0 }),
      );
      const got = await reply;
      if ("error" in got) throw new Error(got.error);
      const [set] = got.result.statements[0]?.sets ?? [];
      expect(got.id).toBe(7);
      expect(set?.columns).toEqual(["id", "name"]);
      expect(set?.rows).toHaveLength(100);
      expect(set?.rows[99]).toEqual(["99", "row 99, quoted"]);
      expect(set?.truncated).toBe(true);
    } finally {
      port1.close();
      port2.close();
    }
  });

  it("the frame posts the runner's bytes to output-worker.js and never decodes them", async () => {
    const workers = fakeWorkers();
    const reader = createOutputReader(workers.start);
    const outcome = await createRunner(onePsql(psqlCsv()) as never).run(psqlRun(500));
    // The frame's part ends when the message is posted; the stand-in worker answers a turn later.
    const decode = vi.spyOn(TextDecoder.prototype, "decode");
    const reply = reader.read("postgresql", outcome, reading(500), 0);
    expect(decode).not.toHaveBeenCalled();
    decode.mockRestore();
    const result = await reply;
    const [message] = workers.posted as Array<{ outcome: { stdout: unknown } }>;
    expect(message?.outcome.stdout).toBeInstanceOf(Uint8Array);
    expect(workers.starts).toEqual([expect.stringMatching(/\/output-worker\.js$/)]);
    expect(result.statements[0]?.sets[0]?.rows).toHaveLength(500);
  });

  it("50 MiB of output: the frame only posts the bytes; the worker reads them into 500 rows", async () => {
    const stdout = psqlCsv(1_850_000);
    expect(stdout.length).toBeGreaterThan(50 * 1024 * 1024);
    const workers = fakeWorkers();
    workers.holdReplies();
    const reader = createOutputReader(workers.start);
    const outcome = await createRunner(onePsql(stdout) as never).run(psqlRun(500));
    const posting = performance.now();
    void reader.read("postgresql", outcome, reading(500), 0);
    const posted = performance.now() - posting;
    const [message] = workers.posted as Array<Parameters<typeof answer>[0]>;
    if (!message) throw new Error("nothing posted");
    // What the worker takes (about 0.9 s in Node on a laptop) would have been one task in the frame.
    const reply = answer(message);
    if ("error" in reply) throw new Error(reply.error);
    expect(posted).toBeLessThan(16);
    expect(reply.result.statements[0]?.sets[0]?.rows).toHaveLength(500);
    expect(reply.result.statements[0]?.sets[0]?.truncated).toBe(true);
  }, 60_000);

  it("cancel stops the worker reading, the run says Cancelled, and the next read starts afresh", async () => {
    const workers = fakeWorkers();
    const busy: number[] = [];
    const reader = createOutputReader(workers.start, { onBusy: (n) => busy.push(n) });
    workers.holdReplies();
    const executor = createExecutor({
      runner: { run: async () => plain(psqlCsv()) },
      output: reader,
      clients: { get: async () => ({ command: "psql", flavor: "postgresql", version: "17" }) },
      settings: () => fromValues({}),
      confirm: async () => true,
      passwords: { get: () => undefined, set: () => {}, ask: async () => undefined },
      cancelled: (message: string) => new Error(message),
    } as never);
    const conn = { id: "c", engine: "postgresql", tag: "none", readOnly: false } as never;
    const run = executor.execute(conn, "SELECT id, name FROM t");
    await vi.waitFor(() => expect(workers.posted).toHaveLength(1));
    reader.cancel();
    const { result } = await run;
    expect(result.error).toEqual({ kind: "cancelled", message: "Cancelled." });
    expect(workers.terminated).toEqual([0]);
    expect(busy).toEqual([1, 0]);
    reader.read("postgresql", plain(psqlCsv()), reading(10), 0).catch(() => {});
    expect(workers.starts).toHaveLength(2);
  });

  it("a worker that stops fails its reads with a sentence", async () => {
    const workers = fakeWorkers();
    workers.holdReplies();
    let fail: (event: { message: string }) => void = () => {};
    const reader = createOutputReader((url) => {
      const worker = workers.start(url) as unknown as { onerror: typeof fail };
      queueMicrotask(() => {
        fail = (event) => worker.onerror?.(event);
      });
      return worker as unknown as Worker;
    });
    const read = reader.read("postgresql", plain(psqlCsv()), reading(10), 0);
    await Promise.resolve();
    await Promise.resolve();
    fail({ message: "" });
    await expect(read).rejects.toThrow("The result reader stopped.");
  });
});
