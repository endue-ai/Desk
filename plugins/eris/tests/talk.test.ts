import { describe, expect, it } from "vitest";
import { completeWords } from "../ui/talk.js";

describe("streaming answers word by word", () => {
  it("holds back a word until the space after it arrives", () => {
    expect(completeWords("Hel", false)).toEqual([]);
    expect(completeWords("Hello wor", false)).toEqual(["Hello"]);
    expect(completeWords("Hello world ", false)).toEqual(["Hello", "world"]);
  });

  it("shows every word once the answer is final", () => {
    expect(completeWords("Hello world", true)).toEqual(["Hello", "world"]);
    expect(completeWords("  spaced   out ", true)).toEqual(["spaced", "out"]);
    expect(completeWords("", true)).toEqual([]);
  });
});
