// A big paste is read in a worker (PG-43, #470): the worker answers what the frame would, and text
// over 16 KiB (a few thousand cells) goes to the worker the grid starts, never read in the frame.
import { describe, expect, it } from "vitest";
import { readPaste } from "../ui/edit/paste-text.js";
import { createPasteReader, IN_WORKER } from "../ui/grid/paste.js";
import { answer } from "../ui/grid/paste-worker.js";

/** A stand-in for startWorker that runs paste-worker.js's answer a turn later. */
function fakeWorkers() {
  const started: string[] = [];
  const posted: unknown[] = [];
  const start = (url: URL) => {
    started.push(url.pathname.split("/").pop() ?? "");
    const worker = {
      onmessage: null as null | ((event: { data: unknown }) => void),
      onerror: null as null | (() => void),
      postMessage(data: Parameters<typeof answer>[0]) {
        posted.push(data);
        setTimeout(() => worker.onmessage?.({ data: answer(data) }), 0);
      },
      terminate() {},
    };
    return worker as unknown as Worker;
  };
  return { start, started, posted };
}

const big = Array.from({ length: 4000 }, (_, i) => `${i}\tname ${i}\t"a ""quoted""\tcell"`).join(
  "\n",
);

describe("a big paste in the worker", () => {
  it("answers what the frame reads", () => {
    expect(answer({ id: 3, text: big, ours: false })).toEqual({ id: 3, ...readPaste(big) });
    expect(answer({ id: 4, text: "a\\tb", ours: true })).toEqual({
      id: 4,
      rows: [["a\tb"]],
      format: "value",
    });
  });

  it("reads text over 16 KiB in the worker and smaller text in the frame", async () => {
    expect(IN_WORKER).toBe(16 * 1024);
    expect(big.length).toBeGreaterThan(IN_WORKER);
    const workers = fakeWorkers();
    const reader = createPasteReader(workers.start);
    const small = reader.read("a\tb", false);
    expect(small).toEqual({ rows: [["a", "b"]], format: "tsv" });
    expect(workers.started).toEqual([]);
    const read = reader.read(big, false);
    expect(read).toBeInstanceOf(Promise);
    expect(await read).toEqual(readPaste(big));
    expect(workers.started).toEqual(["paste-worker.js"]);
    expect(workers.posted).toHaveLength(1);
    // The worker is started once.
    await reader.read(`${big}\n1\t2\t3`, false);
    expect(workers.started).toHaveLength(1);
  });

  it("reads in the frame where no worker can start", () => {
    const reader = createPasteReader(undefined);
    expect(reader.read(big, false)).toEqual(readPaste(big));
  });
});
