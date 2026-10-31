import { describe, expect, it } from "vitest";
import { emptyState, sampleState } from "./state";

describe("the shell's state", () => {
  it("starts empty in the app: no sample drawer items, attention, desks, brain or listening", () => {
    const s = emptyState("en");
    expect(s.drawer).toEqual([]);
    expect(s.attention).toEqual([]);
    expect(s.desks).toEqual([]);
    expect(s.brain).toEqual({ mode: "offline" });
    expect(s.sees).toEqual({ folders: [], calendar: false, mail: false, mic: false });
    expect(s.listening).toBe(false);
    expect(s.lang).toBe("en");
  });

  it("keeps the sample state for the dev page and the fixtures, dated from a wall clock", () => {
    const epoch = Date.parse("2026-10-28T09:00:00.000Z");
    const s = sampleState("ko", epoch);
    expect(s.drawer.map((d) => d.name)).toEqual([
      "brief.pdf",
      "Weather this week",
      "Inbox summary",
    ]);
    expect(s.drawer.map((d) => (epoch - d.at) / 3_600_000)).toEqual([3, 2, 18]);
    expect(s.attention).toHaveLength(2);
  });
});
