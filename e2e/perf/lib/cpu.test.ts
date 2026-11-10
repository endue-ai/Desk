import { describe, expect, it } from "vitest";
import { cpuPercent, cpuTime, cpuTree, parseCpu } from "./cpu";

describe("the app's CPU from ps", () => {
  it("reads ps's time in each of its forms", () => {
    expect(cpuTime("0:01.50")).toBe(1.5);
    expect(cpuTime("12:34.00")).toBe(754);
    expect(cpuTime("1:02:03")).toBe(3723);
    expect(cpuTime("2-00:00:01")).toBe(172_801);
    expect(cpuTime("n/a")).toBeNull();
  });

  it("counts the app's own process and its tree over a stretch, processes that came or went too", () => {
    const before = parseCpu(
      [
        "  100     1   0:10.00 endue-desk",
        "  101   100   0:20.00 endue-desk Helper (GPU)",
        "  999     1 0:50.00 other",
      ].join("\n"),
    );
    const after = parseCpu(
      [
        "  100     1   0:10.40 endue-desk",
        "  101   100   0:20.60 endue-desk Helper (GPU)",
        "  102   101   0:00.20 endue-desk Helper (Renderer)",
        "  999     1   0:59.00 other",
        "garbage",
      ].join("\n"),
    );
    expect(cpuTree(after, 100).map((p) => p.pid)).toEqual([100, 101, 102]);
    expect(cpuPercent(before, after, 100, 10)).toEqual({ app: 4, tree: 12 });
    expect(cpuPercent([], after, 100, 10).app, "no reading before").toBeNull();
  });
});
