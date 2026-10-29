import { describe, expect, it } from "vitest";
import {
  examplesFor,
  layoutName,
  matchExample,
  nextScene,
  order,
  RESUMABLE,
  standing,
} from "../ui/flow.js";
import { EXAMPLES } from "../ui/script.js";

describe("first-run scene order (docs/ko/first-run-scenario.md)", () => {
  it("runs scenes 3 to 10 in order", () => {
    expect(order()).toEqual([
      "microphone",
      "name",
      "sign-in",
      "desk",
      "agents",
      "task",
      "layout",
      "outro",
    ]);
    expect(nextScene("agents", {})).toBe("task");
    expect(nextScene("outro", {})).toBeNull();
  });

  it("asks for the microphone and the name at the first task after Skip intro", () => {
    const state = { skipped: true };
    expect(nextScene("sign-in", state)).toBe("desk");
    expect(nextScene("agents", state)).toBe("microphone");
    expect(nextScene("microphone", { ...state, micAsked: true })).toBe("name");
    expect(nextScene("name", { ...state, micAsked: true, name: "Ada" })).toBe("task");
  });

  it("does not ask twice when Skip intro came after the microphone or the name", () => {
    expect(nextScene("agents", { skipped: true, micAsked: true })).toBe("name");
    expect(nextScene("agents", { skipped: true, micAsked: true, name: "Ada" })).toBe("task");
  });

  it("leaves endue's agents out outside the service region", () => {
    expect(order({ region: false })).not.toContain("agents");
    expect(nextScene("desk", { region: false })).toBe("task");
  });

  it("knows what stands already when a first run resumes", () => {
    expect(standing("sign-in", {})).toEqual({ frame: false, agents: false });
    expect(standing("agents", {})).toEqual({ frame: true, agents: false });
    expect(standing("task", {})).toEqual({ frame: true, agents: true });
    expect(standing("microphone", { skipped: true })).toEqual({ frame: true, agents: true });
    expect(RESUMABLE).not.toContain("arrival");
    expect(RESUMABLE).not.toContain("greeting");
  });
});

describe("answers", () => {
  it("keeps a layout's name without its full stop", () => {
    expect(layoutName("Morning.")).toBe("Morning");
    expect(layoutName("  Deep work!  ")).toBe("Deep work");
    expect(layoutName("   ")).toBe("");
  });

  it("offers only examples whose source is connected, and always Plan my week", () => {
    expect(examplesFor([], EXAMPLES).map((e: { text: string }) => e.text)).toEqual([
      "Plan my week",
    ]);
    expect(examplesFor(["calendar"], EXAMPLES).map((e: { kind: string }) => e.kind)).toEqual([
      "tomorrow",
      "week",
    ]);
    expect(examplesFor(["folder", "calendar", "mail"], EXAMPLES)).toHaveLength(3);
  });

  it("recognises a typed example and leaves anything else to the brain", () => {
    expect(matchExample("what's on tomorrow", EXAMPLES)).toBe("tomorrow");
    expect(matchExample("Plan my week.", EXAMPLES)).toBe("week");
    expect(matchExample("Write a haiku", EXAMPLES)).toBeNull();
  });
});
