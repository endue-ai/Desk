import { describe, expect, it } from "vitest";
import { CALENDAR, findOverlap, moveAfter } from "../ui/samples.js";
import { AGENT_SAY, AGENTS, SAY } from "../ui/script.js";

describe("tomorrow's schedule", () => {
  it("finds the first two events that overlap", () => {
    const overlap = findOverlap(CALENDAR.events);
    expect(overlap?.map((e) => e.start)).toEqual(["10:00", "10:30"]);
    expect(SAY.discord("10:00", "10:30")).toBe(
      "Small bit of discord: 10:00 and 10:30 overlap. Move one?",
    );
  });

  it("finds nothing on a clear day", () => {
    expect(
      findOverlap([
        { start: "09:00", end: "10:00", title: "a" },
        { start: "10:00", end: "11:00", title: "b" },
      ]),
    ).toBeNull();
  });

  it("moves an event to start when the other ends, keeping its length", () => {
    const [first, second] = findOverlap(CALENDAR.events) ?? [];
    if (!first || !second) throw new Error("no overlap");
    expect(moveAfter(second, first)).toMatchObject({ start: "11:00", end: "11:30" });
  });
});

describe("endue's agents", () => {
  it("are Tin, Seed and Muse, Tin first; Muse waits", () => {
    expect(AGENTS.map((a) => a.name)).toEqual(["Tin", "Seed", "Muse"]);
    expect(AGENTS.filter((a) => a.speaks).map((a) => a.id)).toEqual(["tin", "seed"]);
  });

  it("let Tin speak from the calendar when it is connected", () => {
    expect(AGENT_SAY.tin(true, true)).toBe(
      "Tin here. Two of tomorrow's meetings overlap. Want me to sort it out?",
    );
    expect(AGENT_SAY.tin(false, true)).toBe("Tin here. Connect a calendar and I'll keep it tidy.");
  });
});
