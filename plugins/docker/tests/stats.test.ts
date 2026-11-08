import { describe, expect, it } from "vitest";
import { sparkPoints } from "../ui/sparkline.js";
import { createHistory, ioBytes, parseStatsLine, STREAM_ARGS } from "../ui/stats.js";
import { DB_ID, WEB_ID } from "./fixtures";
import { STATS_STREAM, statsLine } from "./fixtures-more";
import { engine, mount } from "./harness";

/** Feed the stream's lines, one frame (three lines) a second. */
function feedAll(history: ReturnType<typeof createHistory>, lines: string[], start = 0) {
  let now = start;
  for (const raw of lines) {
    const sample = parseStatsLine(raw);
    if (sample) history.feed(sample, now);
    if (raw.trim().endsWith("[K")) now += 1000;
  }
  return now;
}

describe("the stats stream", () => {
  it("reads each line of a frame and skips the cursor codes between frames", () => {
    expect(STATS_STREAM[0]?.charCodeAt(0)).toBe(27);
    const samples = STATS_STREAM.map(parseStatsLine);
    expect(samples.filter(Boolean)).toHaveLength(6);
    expect(samples[0]).toMatchObject({ id: WEB_ID, name: "shop-web-1", cpu: 0.17 });
    expect(samples[2]).toBeUndefined();
    expect(ioBytes("233MB / 10.7MB")).toEqual({ in: 233_000_000, out: 10_700_000 });
  });

  it("feeds the sparklines: CPU, memory and network per second, a point per spacing", () => {
    const history = createHistory({ spacing: () => 1000 });
    feedAll(history, STATS_STREAM);
    const db = history.snapshot(DB_ID);
    expect(db?.cpu).toEqual([1.57, 12.4, 50]);
    expect(db?.mem).toEqual([54_955_868, 62_914_560, 67_108_864]);
    const web = history.snapshot(WEB_ID.slice(0, 12));
    // 233 + 10.7 MB, then a megabyte more each way every second: 2 MB/s.
    expect(web?.net).toEqual([0, 2_000_000, 2_000_000]);
    expect(web?.rate).toBe(2_000_000);
    expect(web?.memLimit).toBe(8_318_277_911);
    expect(sparkPoints(db?.cpu ?? [], { width: 60, height: 16, max: 100 })).toBe(
      "0,14.8 30,13.3 60,8",
    );
    expect(sparkPoints([0, 5, 10], { width: 40, height: 11, slots: 5 })).toBe("20,10 30,5.5 40,1");
    expect([...history.latest().keys()]).toEqual([WEB_ID, DB_ID]);
  });

  it("keeps one point per spacing however often docker redraws, the newest following", () => {
    const history = createHistory({ spacing: () => 2000, points: 3 });
    const at = (cpu: string, now: number) =>
      history.feed(
        parseStatsLine(statsLine(DB_ID, "shop-db-1", cpu, "1MiB / 2GiB", "0B / 0B")) as never,
        now,
      );
    at("1%", 0);
    at("2%", 500);
    at("3%", 2000);
    at("4%", 4000);
    at("5%", 6000);
    at("6%", 6500);
    expect(history.snapshot(DB_ID)?.cpu).toEqual([3, 4, 6]);
    history.keep(new Set([WEB_ID]));
    expect(history.snapshot(DB_ID)).toBeUndefined();
  });
});

describe("resource use on screen", () => {
  it("streams while containers show, patches the view, and stops on another list", async () => {
    const m = await mount({
      init: { "endue.docker.stats-interval": 1 },
      script: engine({ stats: { hang: true } }),
    });
    await m.keys.containers?.();
    await m.settle();
    const stream = m.docker.last("stats");
    expect(stream?.args).toEqual([...STREAM_ARGS]);
    for (const raw of STATS_STREAM.slice(0, 3)) m.docker.write(stream?.procId ?? "", `${raw}\n`);
    await m.settle();
    m.clock.advance(500);
    await m.settle();
    expect(m.view.statsViews.at(-1)?.(DB_ID)?.cpu).toEqual([1.57]);
    const listed = (await m.host.invoke("endue.docker.containers")) as Array<{
      id: string;
      stats: { cpuText: string } | null;
    }>;
    expect(listed.find((c) => c.id === DB_ID)?.stats?.cpuText).toBe("1.57%");
    await m.keys.images?.();
    await m.settle();
    expect(m.docker.killed.map((k) => k.procId)).toContain(stream?.procId);
    expect(m.docker.of("stats")).toHaveLength(1);
  });

  it("never streams when the interval is 0", async () => {
    const m = await mount({ script: engine({ stats: { hang: true } }) });
    await m.keys.containers?.();
    await m.settle();
    expect(m.docker.of("stats")).toEqual([]);
  });
});
