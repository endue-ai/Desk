import { describe, expect, it } from "vitest";
import { actionFor, BINDINGS, hints, pressOf } from "../ui/keys.js";

const press = (key: string, extra: Partial<ReturnType<typeof pressOf>> = {}) => ({
  key,
  mod: false,
  shift: false,
  alt: false,
  ...extra,
});

describe("the keys inside the Git surface", () => {
  it("map single letters to actions per view", () => {
    expect(actionFor("status", press("s"))).toBe("stage");
    expect(actionFor("status", press("S"))).toBe("stageAll");
    expect(actionFor("status", press("k"))).toBe("discard");
    expect(actionFor("status", press("c"))).toBe("commit");
    expect(actionFor("status", press("P"))).toBe("push");
    expect(actionFor("status", press("Enter"))).toBe("visit");
    expect(actionFor("log", press("Enter"))).toBe("diff");
    expect(actionFor("log", press("+"))).toBe("more");
    expect(actionFor("diff", press("q"))).toBe("status");
    expect(actionFor("status", press("z"))).toBeUndefined();
  });

  it("move with the arrows and n/p in every list view", () => {
    for (const view of ["status", "log", "diff"] as const) {
      expect(actionFor(view, press("ArrowDown"))).toBe("next");
      expect(actionFor(view, press("n"))).toBe("next");
      expect(actionFor(view, press("ArrowUp"))).toBe("previous");
      expect(actionFor(view, press("p"))).toBe("previous");
      expect(actionFor(view, press("Home"))).toBe("first");
      expect(actionFor(view, press("End"))).toBe("last");
    }
  });

  it("leave chords to the desk, apart from Mod+Enter and Escape in the editor", () => {
    expect(actionFor("status", press("s", { mod: true }))).toBeUndefined();
    expect(actionFor("status", press("g", { alt: true }))).toBeUndefined();
    expect(actionFor("commit", press("Enter", { mod: true }))).toBe("submitCommit");
    expect(actionFor("commit", press("Enter"))).toBeUndefined();
    expect(actionFor("commit", press("Escape"))).toBe("cancelCommit");
    expect(actionFor("status", press("Escape"))).toBeUndefined();
  });

  it("hints list the labelled keys of a view and pressOf reads either modifier as Mod", () => {
    expect(hints("status")).toMatch(/^s stage · S stage all · u unstage/);
    expect(hints("commit")).toBe("Mod+Enter commit · Escape cancel");
    for (const bindings of Object.values(BINDINGS))
      expect(new Set(bindings.map((b) => b.key)).size).toBe(bindings.length);
    expect(
      pressOf({ key: "Enter", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }),
    ).toEqual({ key: "Enter", mod: true, shift: false, alt: false });
    expect(
      pressOf({ key: "Enter", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }).mod,
    ).toBe(true);
  });
});
