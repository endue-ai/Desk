import { describe, expect, it } from "vitest";
import { isBinding } from "../core/defaults";
import { canonical, formatCombo } from "../input";
import {
  canonicalSequence,
  chordsOf,
  formatChords,
  formatSequence,
  isPrefix,
  isSequence,
  parseSequence,
} from "./parse";

describe("key sequences: parsing and printing", () => {
  it("round-trips a sequence: written → canonical → read on each platform → canonical again", () => {
    for (const written of ["Mod+K Mod+S", "Ctrl+X Ctrl+F", "Ctrl+C p f", "Mod+K Mod+T Shift+T"]) {
      expect(parseSequence(written)).toEqual({ ok: true, chords: written.split(" ") });
      for (const platform of ["mac", "other"] as const) {
        const once = canonicalSequence(written, platform);
        expect(canonicalSequence(once, platform)).toBe(once);
        expect(parseSequence(once).ok).toBe(true);
        expect(formatChords(once, platform)).toHaveLength(written.split(" ").length);
      }
    }
    expect(canonicalSequence("Mod+K Mod+s", "mac")).toBe("Meta+K Meta+S");
    expect(canonicalSequence("Mod+K Mod+S", "other")).toBe("Control+K Control+S");
    expect(formatSequence("Meta+K Meta+S", "mac")).toBe("⌘K ⌘S");
    expect(formatSequence("Control+K Control+S", "other")).toBe("Ctrl+K Ctrl+S");
    expect(formatChords("Control+X Control+F", "mac")).toEqual(["⌃X", "⌃F"]);
  });

  it("reads plain keys after a prefix", () => {
    expect(parseSequence("Ctrl+C p f")).toEqual({ ok: true, chords: ["Ctrl+C", "p", "f"] });
    expect(canonicalSequence("Ctrl+C p f", "other")).toBe("Control+C P F");
    expect(formatSequence("Control+C P F", "mac")).toBe("⌃C P F");
    expect(canonicalSequence("Ctrl+C Space +", "other")).toBe("Control+C Space +");
    expect(chordsOf("Control+C P F")).toEqual(["Control+C", "P", "F"]);
  });

  it("keeps a single chord what it was, through canonical and formatCombo too", () => {
    expect(canonical("Mod+Shift+p", "mac")).toBe("Meta+Shift+P");
    expect(canonical("Mod++", "other")).toBe("Control++");
    expect(formatCombo("Meta+Shift+P", "mac")).toBe("⇧⌘P");
    expect(formatCombo("Control++", "other")).toBe("Ctrl++");
    // The same functions read sequences now, chord by chord.
    expect(canonical("Mod+K Mod+S", "mac")).toBe("Meta+K Meta+S");
    expect(formatCombo("Meta+K Meta+S", "mac")).toBe("⌘K ⌘S");
  });

  it("refuses an empty chord, a dangling modifier, other white space and a key too long", () => {
    const problem = (text: string) => {
      const parsed = parseSequence(text);
      return parsed.ok ? "" : parsed.problem;
    };
    expect(problem("")).toMatch(/not empty/);
    expect(problem("Mod+K  Mod+S")).toMatch(/chord 2 .* is empty/);
    expect(problem("Ctrl+X ")).toMatch(/chord 2 .* is empty/);
    expect(problem(" Ctrl+X")).toMatch(/chord 1 .* is empty/);
    expect(problem("Ctrl+X Ctrl+")).toMatch(/chord 2 .*\(Ctrl\+\) has no key/);
    expect(problem("Ctrl+X\tCtrl+F")).toMatch(/one space, not a tab/);
    expect(problem(Array.from({ length: 100 }, () => "Mod+K").join(" "))).toMatch(/at most 256/);
    expect(isSequence(42)).toBe(false);
    expect(isSequence("Ctrl+X Ctrl+F")).toBe(true);
  });

  it("lets the person's layer hold sequences, as keys.yaml does", () => {
    expect(isBinding({ key: "Ctrl+X Ctrl+F", command: "desk.files.open" })).toBe(true);
    expect(isBinding({ key: "Ctrl+C p f", mac: "Meta+C P F", command: "" })).toBe(true);
    expect(isBinding({ key: "Ctrl+X  Ctrl+F", command: "desk.files.open" })).toBe(false);
    expect(isBinding({ key: "Mod+K", mac: "Meta+K ", command: "desk.files.open" })).toBe(false);
  });

  it("knows a proper prefix", () => {
    expect(isPrefix(["Meta+K"], ["Meta+K", "Meta+S"])).toBe(true);
    expect(isPrefix(["Meta+K"], ["Meta+K"])).toBe(false);
    expect(isPrefix(["Meta+J"], ["Meta+K", "Meta+S"])).toBe(false);
  });
});
