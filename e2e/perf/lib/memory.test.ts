import { describe, expect, it } from "vitest";
import { findUnder, parsePs, rssMb, treeOf } from "./memory";

// `ps -A -o pid=,ppid=,rss=,comm=` under the e2e runner: tauri-driver starts WebKitWebDriver, which
// starts the app, which starts WebKit's processes. Names may hold spaces.
const PS = `
    1     0  11904 systemd
  900     1   5120 tauri-driver
  901   900  20480 WebKitWebDriver
  902   901 204800 endue-desk
  903   902 307200 WebKitWebProces
  904   902  51200 WebKitNetworkPr
  905   903   1024 some helper
  950     1 409600 endue-desk
`;

describe("the app's memory from ps", () => {
  it("parses pid, parent, RSS in KiB and the name", () => {
    const procs = parsePs(PS);
    expect(procs).toHaveLength(8);
    expect(procs[6]).toEqual({ pid: 905, ppid: 903, rssKb: 1024, name: "some helper" });
    expect(parsePs("garbage\n\n")).toEqual([]);
  });

  it("finds the app under the driver, not another desk elsewhere", () => {
    const procs = parsePs(PS);
    expect(findUnder(procs, 900, "endue-desk")?.pid).toBe(902);
    expect(findUnder(procs, 901, "endue-desk")?.pid).toBe(902);
    expect(findUnder(procs, 904, "endue-desk")).toBeUndefined();
  });

  it("sums the RSS of the app and its descendants only", () => {
    const procs = parsePs(PS);
    const tree = treeOf(procs, 902);
    expect(tree.map((p) => p.pid)).toEqual([902, 903, 904, 905]);
    // 204800 + 307200 + 51200 + 1024 KiB
    expect(rssMb(tree)).toBe(551);
    expect(treeOf(procs, 4242)).toEqual([]);
  });
});
