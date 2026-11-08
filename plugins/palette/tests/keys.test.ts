import { describe, expect, it } from "vitest";
import { chordsOf, keyHint } from "../ui/keys.js";

describe("the palette's key hints", () => {
  it("reads each key's chords: a sequence is chords a space apart (ADR 0118)", () => {
    expect(chordsOf(["⌘K ⌘S", "⇧⌘P"])).toEqual([["⌘K", "⌘S"], ["⇧⌘P"]]);
    expect(chordsOf(["Ctrl+C P F", ""])).toEqual([["Ctrl+C", "P", "F"]]);
  });

  it("makes one <kbd> per chord, chords a space apart and keys a comma apart", () => {
    const make = (tag: string, _: object, text: string) => `<${tag}>${text}</${tag}>`;
    expect(keyHint(["⌘K ⌘S", "⇧⌘P"], make).join("")).toBe(
      "<kbd>⌘K</kbd> <kbd>⌘S</kbd>, <kbd>⇧⌘P</kbd>",
    );
    expect(keyHint([], make)).toEqual([]);
  });
});
