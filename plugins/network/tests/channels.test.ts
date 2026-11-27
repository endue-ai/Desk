// Wi-Fi channel congestion (NET-12–14) from system_profiler's report: overlap on 2.4 GHz, aligned
// blocks on 5 and 6 GHz, the recommendation, and the report with its SSIDs hidden.
import { describe, expect, it } from "vitest";
import { bandModel, channelsModel, levelOf, spanOf, weightOf } from "../ui/channels.js";
import { parseWifi } from "../ui/wifi.js";
import * as F from "./fixtures";
import { englishT } from "./harness";

const heard = (
  channel: number,
  band: "2.4" | "5" | "6",
  width = 20,
  rssi: number | null = -50,
) => ({
  ssid: null,
  channel,
  band,
  width,
  security: "wpa2-personal",
  rssi,
  noise: -92,
  phy: "802.11ax",
});

describe("channel congestion", () => {
  it("spans each network over the channels its width covers", () => {
    expect(spanOf(heard(6, "2.4"))).toEqual([6, 6]);
    expect(spanOf(heard(6, "2.4", 40))).toEqual([4, 8]);
    expect(spanOf(heard(44, "5", 80))).toEqual([36, 48]);
    expect(spanOf(heard(157, "5", 80))).toEqual([149, 161]);
    expect(spanOf(heard(128, "5", 160))).toEqual([100, 128]);
    expect(spanOf(heard(48, "5", 40))).toEqual([44, 48]);
    expect(spanOf(heard(97, "6", 160))).toEqual([97, 125]);
  });

  it("counts overlapping 2.4 GHz neighbours and weighs loud networks more", () => {
    const band = bandModel("2.4", [heard(6, "2.4"), heard(6, "2.4"), heard(7, "2.4")], null);
    const at = (ch: number) => band.lanes.find((l) => l.channel === ch);
    // Two loud networks on 6 and one on 7 (three quarters over 6).
    expect(at(6)).toEqual({ channel: 6, load: 2.75, level: "crowded", count: 3 });
    expect(at(9)?.load).toBe(1);
    expect(at(11)).toEqual({ channel: 11, load: 0, level: "free", count: 0 });
    expect(band.recommended).toBe(1);
    expect(weightOf(-90)).toBe(0.2);
    expect(weightOf(-50)).toBe(1);
    expect(weightOf(null)).toBe(0.6);
    expect(levelOf(0.99)).toBe("free");
    expect(levelOf(1)).toBe("busy");
    expect(levelOf(2.5)).toBe("crowded");
  });

  it("says 'Channel 6 is crowded; channel 11 is recommended' when the joined channel is crowded", async () => {
    const t = await englishT();
    const around = [heard(6, "2.4"), heard(6, "2.4"), heard(5, "2.4"), heard(1, "2.4", 20, -55)];
    const band = bandModel("2.4", around, heard(6, "2.4"));
    expect(band.current).toMatchObject({ channel: 6, current: true });
    expect(band.recommended).toBe(11);
    expect(t(band.verdict.key, band.verdict.params)).toBe(
      "Channel 6 is crowded; channel 11 is recommended.",
    );
    const calm = bandModel("2.4", [heard(1, "2.4", 20, -85)], heard(11, "2.4"));
    expect(t(calm.verdict.key, calm.verdict.params)).toBe("Channel 11 is free; nothing to change.");
  });

  it("recommends the freest 80 MHz block on 5 GHz", () => {
    const band = bandModel("5", [heard(36, "5", 80), heard(149, "5", 80, -60)], heard(44, "5", 80));
    expect(band.recommended).toBe(149);
    expect(band.verdict.key).toBe("channels.verdict.move");
    const quiet = bandModel("5", [heard(36, "5", 80, -88)], heard(149, "5", 80));
    expect(quiet.recommended).toBe(149);
    expect(quiet.verdict.key).toBe("channels.verdict.free");
  });

  it("draws the three bands of the report apart, with the SSIDs hidden", () => {
    const report = parseWifi(F.WIFI);
    if (!report) throw new Error("no report");
    const bands = channelsModel(report);
    expect(bands.map((b) => b.band)).toEqual(["2.4", "5", "6"]);
    const two = bands[0]!;
    expect(two.current?.channel).toBe(6);
    expect(two.networks).toHaveLength(5);
    expect(two.networks.every((n) => n.ssid === null)).toBe(true);
    expect(two.lanes.find((l) => l.channel === 6)?.level).toBe("crowded");
    expect(two.recommended).toBe(11);
    expect(two.verdict).toEqual({
      key: "channels.verdict.move",
      params: { band: "2.4", channel: 6, best: 11 },
    });
    expect(bands[2]!.networks[0]).toMatchObject({ channel: 97, from: 97, to: 125 });
    expect(report.hidden).toBe(true);
  });
});
