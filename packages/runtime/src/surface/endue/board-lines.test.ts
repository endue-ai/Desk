import { describe, expect, it } from "vitest";
import { buildLines, carried, type Geometry, type LineRow } from "./board-lines";

const row = (
  id: string,
  side: "in" | "out",
  top: number,
  extra: Partial<LineRow> = {},
): LineRow => ({
  id,
  side,
  state: "on",
  selected: false,
  box:
    side === "in"
      ? { left: 0, top, right: 200, bottom: top + 54 }
      : { left: 700, top, right: 900, bottom: top + 54 },
  y: top + 27,
  ...extra,
});
const side: Geometry = {
  hub: { left: 260, top: 40, right: 640, bottom: 500 },
  hubY: 120,
  stacked: false,
  trunkX: 12,
  rows: [
    row("console", "in", 40),
    row("channel", "in", 102, { state: "unknown" }),
    row("gmail", "out", 40, { state: "bad" }),
    row("outputs", "out", 102, { selected: true }),
  ],
};

describe("the lines of the Studio board (ADR 0232)", () => {
  it("carries the strongest state through a shared stretch: on, then a problem, then off", () => {
    expect(carried(["off", "bad", "on"])).toBe("on");
    expect(carried(["unknown", "off", "bad"])).toBe("bad");
    expect(carried(["unknown", "off"])).toBe("off");
    expect(carried([])).toBe("unknown");
  });

  it("side by side, runs a curve from each way in to the agent and from the agent to each thing it reaches", () => {
    const { paths, ports, arrows } = buildLines(side);
    const console_ = paths.find((p) => p.key === "console");
    // From the row's right edge, level, into the agent's left at its port, short of the arrowhead.
    expect(console_?.d).toBe("M200 67 C230 67 230 120 252 120");
    const gmail = paths.find((p) => p.key === "gmail");
    expect(gmail?.d.startsWith("M640 120 C")).toBe(true);
    expect(gmail?.d.endsWith(" 692 67")).toBe(true);
    // A way in leaves at a dot; the lines meet the agent at one arrowhead and leave it at one dot.
    expect(ports.map((p) => p.key)).toEqual(["console", "channel", "hub-out"]);
    expect(arrows.map((a) => a.key)).toEqual(["gmail", "outputs", "hub-in"]);
    expect(arrows.find((a) => a.key === "hub-in")?.state).toBe("on");
    expect(ports.find((p) => p.key === "hub-out")?.state).toBe("on");
  });

  it("dashes a line that is off or not read here, and draws an unfolded row's heavier and last", () => {
    const { paths } = buildLines(side);
    const by = Object.fromEntries(paths.map((p) => [p.key, p]));
    expect([by.console?.dashed, by.channel?.dashed, by.gmail?.dashed]).toEqual([
      false,
      true,
      false,
    ]);
    expect([by.console?.width, by.channel?.width, by.outputs?.width]).toEqual([1.8, 1.4, 3]);
    expect(paths.at(-1)?.key).toBe("outputs");
    expect(paths[0]?.key).toBe("channel");
  });

  it("stacked, runs down a trunk at the left, each stretch in the strongest state through it", () => {
    const stacked: Geometry = {
      hub: { left: 24, top: 300, right: 500, bottom: 800 },
      hubY: 400,
      stacked: true,
      trunkX: 12,
      rows: [
        {
          ...row("console", "in", 40, { state: "off" }),
          box: { left: 24, top: 40, right: 500, bottom: 94 },
        },
        { ...row("live", "in", 102), box: { left: 24, top: 102, right: 500, bottom: 156 } },
        {
          ...row("devices", "out", 860, { state: "unknown" }),
          box: { left: 24, top: 860, right: 500, bottom: 914 },
        },
        {
          ...row("outputs", "out", 922, { state: "bad" }),
          box: { left: 24, top: 922, right: 500, bottom: 976 },
        },
      ],
    };
    const { paths, ports, arrows } = buildLines(stacked);
    const by = Object.fromEntries(paths.map((p) => [p.key, p]));
    // A branch leaves its row's left edge and turns down into the trunk.
    expect(by["console:branch"]?.d).toBe("M24 67 H20 Q12 67 12 75");
    // Above Live only the console's line runs (off); below it Live's is carried along (on).
    expect(by["console:trunk"]).toMatchObject({ d: "M12 75 V129", state: "off", dashed: true });
    expect(by["live:trunk"]).toMatchObject({ d: "M12 129 V320", state: "on" });
    expect(by["hub-in"]?.state).toBe("on");
    // Out of the agent the trunk carries a problem as far as the last row that has it.
    expect(by["hub-out"]?.state).toBe("bad");
    expect(by["devices:trunk"]?.state).toBe("bad");
    expect(by["devices:branch"]?.state).toBe("unknown");
    expect(by["outputs:trunk"]).toMatchObject({ d: "M12 887 V941", state: "bad" });
    expect(ports.map((p) => p.key)).toEqual(["console", "live", "hub-out"]);
    expect(arrows.map((a) => a.key)).toEqual(["hub-in", "devices", "outputs"]);
    // Every arrowhead points right, at the card's left edge.
    for (const a of arrows) expect(a.d.startsWith("M24 ")).toBe(true);
  });
});
