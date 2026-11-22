// Where a comparison runs (PG-26, ADR 0329): past a few thousand cells in the comparison's worker
// (ui/compare/worker.js, started with the SDK's startWorker and let go when it answers), so two
// large results are never paired on the frame's thread; below that, and without a worker, in
// place. A comparison past the bound is refused before anything is sent.
import { describe, expect, it } from "vitest";
import { createComparer } from "../ui/compare/client.js";
import { compareSets } from "../ui/compare/diff.js";
import { answer } from "../ui/compare/worker.js";

type Rows = (string | null)[][];
const rows = (n: number, shift = 0): Rows =>
  Array.from({ length: n }, (_, i) => [String(i), `v${i < 3 ? i + shift : i}`]);
const side = (r: Rows) => ({ columns: ["id", "v"], rows: r });

/** A stand-in for the SDK's startWorker that answers as worker.js does, a tick later. */
function fakeWorkers() {
  const started: string[] = [];
  const sent: unknown[] = [];
  let terminated = 0;
  const start = (url: URL, options?: { name?: string }) => {
    started.push(`${url.pathname.split("/").slice(-2).join("/")} ${options?.name ?? ""}`);
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: { message: string }) => void) | null,
      postMessage(data: Parameters<typeof answer>[0]) {
        sent.push(data);
        setTimeout(() => worker.onmessage?.({ data: answer(structuredClone(data)) }), 0);
      },
      terminate() {
        terminated++;
      },
    };
    return worker as unknown as Worker;
  };
  return { start, started, sent, terminated: () => terminated };
}

describe("where a comparison runs", () => {
  it("a large comparison runs in the worker and answers what the frame would; a small one runs in place", async () => {
    const workers = fakeWorkers();
    const comparer = createComparer(workers.start, { inline: 100 });
    const before = side(rows(200));
    const after = side(rows(210, 1));
    const got = await comparer.compare(before, after, ["id"]);
    expect(got).toEqual(compareSets(before, after, ["id"]));
    expect(got.counts).toEqual({ added: 10, removed: 0, changed: 3, same: 197 });
    expect(workers.started).toEqual(["compare/worker.js Database comparison"]);
    expect(workers.terminated()).toBe(1);

    const small = await comparer.compare(side(rows(5)), side(rows(5, 1)), null);
    expect(small.counts.changed).toBe(3);
    expect(workers.started).toHaveLength(1);

    // Without a worker (the unit tests, a frame that cannot start one) it runs in place.
    const inPlace = createComparer(undefined, { inline: 100 });
    expect(await inPlace.compare(before, after, ["id"])).toEqual(got);
  });

  it("refuses past the bound before it sends anything, and says a worker's failure", async () => {
    const workers = fakeWorkers();
    const comparer = createComparer(workers.start, { inline: 10, max: 300 });
    await expect(comparer.compare(side(rows(200)), side(rows(2)), null)).rejects.toThrow(
      /^Too large to compare: the result before has 400 cells/u,
    );
    expect(workers.sent).toEqual([]);
    expect(answer({ id: 7, before: side([]), after: side([]), key: ["nope"], keep: 10 })).toEqual({
      id: 7,
      error: "The key nope is not a column of both results.",
    });
    await expect(comparer.compare(side(rows(20)), side(rows(20)), ["nope"])).rejects.toThrow(
      "The key nope is not a column of both results.",
    );
  });
});
