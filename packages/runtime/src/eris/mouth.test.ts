import { describe, expect, test } from "vitest";
import { syllablePulses, syllables } from "./mouth";

describe("one pulse per syllable", () => {
  test("Hangul counts its blocks, Latin its vowel groups, and every word has one", () => {
    expect(syllables("안녕하세요.")).toBe(5);
    expect(syllables("morning")).toBe(2);
    expect(syllables("Eris,")).toBe(2);
    expect(syllables("9:30")).toBe(1);
    expect(syllables("Eris는")).toBe(3);
  });

  test("a word's syllables share the time until the next word", () => {
    const pulses = syllablePulses(
      [
        { word: "좋은", at: 0 },
        { word: "아침", at: 400 },
      ],
      140,
    );
    expect(pulses).toEqual([0, 180, 400, 526]);
  });
});
