import { describe, expect, it } from "vitest";
import { parsePs, rssMb, treeOf } from "./memory";

// `ps -A -o pid=,ppid=,rss=,comm=` under the e2e runner: the runner starts the desk, which starts
// its CEF helpers; another desk runs apart. Names may hold spaces.
const PS = `
    1     0  11904 systemd
  900     1   5120 node
  902   900 204800 endue-desk
  903   902 307200 endue-desk Help
  904   902  51200 endue-desk Help
  905   903   1024 some helper
  950     1 409600 endue-desk
`;

describe("the app's memory from ps", () => {
  it("parses pid, parent, RSS in KiB and the name", () => {
    const procs = parsePs(PS);
    expect(procs).toHaveLength(7);
    expect(procs[5]).toEqual({ pid: 905, ppid: 903, rssKb: 1024, name: "some helper" });
    expect(parsePs("garbage\n\n")).toEqual([]);
  });

  it("sums the RSS of the app and its descendants only, not another desk elsewhere", () => {
    const procs = parsePs(PS);
    const tree = treeOf(procs, 902);
    expect(tree.map((p) => p.pid)).toEqual([902, 903, 904, 905]);
    // 204800 + 307200 + 51200 + 1024 KiB
    expect(rssMb(tree)).toBe(551);
    expect(treeOf(procs, 4242)).toEqual([]);
  });
});
