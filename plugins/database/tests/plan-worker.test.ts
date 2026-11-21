// The plan reader (PG-70): a big JSON plan is read in the plan worker, a small one in place, and a
// worker that fails takes what it was reading with it.
import { describe, expect, it } from "vitest";
import { createPlanReader, INLINE_MAX } from "../ui/explain/reader.js";
import { answer } from "../ui/explain/worker.js";
import { captured, setOf } from "./plans/captured";

/** A plan with as many scans under an Append as it takes to pass `size` characters. */
function big(size: number) {
  const scan = (i: number) => ({
    "Node Type": "Seq Scan",
    "Relation Name": `part_${i}`,
    "Total Cost": 10,
    "Plan Rows": 100,
  });
  const plans = [];
  while (JSON.stringify(plans).length < size) plans.push(scan(plans.length));
  return [{ Plan: { "Node Type": "Append", "Total Cost": 10 * plans.length, Plans: plans } }];
}

/** A worker that answers in this thread, as the real one does in its own. */
function fakeWorkers(log: string[]) {
  return (url: URL, options?: { name?: string }) => {
    log.push(`start ${url.pathname.split("/").at(-1)} ${options?.name}`);
    const worker = {
      onmessage: null as null | ((event: { data: unknown }) => void),
      onerror: null as null | ((event: { message: string }) => void),
      postMessage(data: Parameters<typeof answer>[0]) {
        log.push(`read ${data.id}`);
        setTimeout(() => worker.onmessage?.({ data: answer(data) }), 0);
      },
      terminate: () => log.push("terminate"),
    };
    return worker as unknown as Worker;
  };
}

describe("the plan reader", () => {
  it("reads a big plan in the worker and a small one in place", async () => {
    const log: string[] = [];
    const reader = createPlanReader(fakeWorkers(log));
    const small = await reader.read(setOf(captured()[0]?.plans.join));
    expect(small?.label).toBe("Sort");
    expect(log).toEqual([]);
    const plan = big(INLINE_MAX + 1);
    const read = await reader.read(setOf(plan));
    expect(read?.label).toBe("Append");
    expect(read?.children.length).toBe(plan[0]?.Plan.Plans.length);
    expect(read?.summary?.raw).toBe(JSON.stringify(plan, null, 2));
    await reader.read(setOf(big(INLINE_MAX * 2)));
    expect(log).toEqual(["start worker.js Database plans", "read 1", "read 2"]);
  });

  it("says what the worker could not read, and reads in place without a worker", async () => {
    expect(
      answer({ id: 7, set: { columns: ["QUERY PLAN"], rows: [["[{"]], truncated: false } }),
    ).toMatchObject({
      id: 7,
      error: expect.any(String),
    });
    expect(answer({ id: 8, set: { columns: ["a"], rows: [["1"]], truncated: false } })).toEqual({
      id: 8,
      plan: null,
    });
    const reader = createPlanReader();
    expect((await reader.read(setOf(big(INLINE_MAX * 2))))?.label).toBe("Append");
    const failing = createPlanReader(fakeWorkers([]));
    await expect(
      failing.read({
        columns: ["QUERY PLAN"],
        rows: [[`[${" ".repeat(INLINE_MAX)}{`]],
        truncated: false,
      }),
    ).rejects.toThrow();
  });
});
