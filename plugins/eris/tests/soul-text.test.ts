import { describe, expect, it } from "vitest";
import { layoutLine, SOLEMN, scatterDelays, WISP, wordsFromText } from "../ui/soul-text.js";

describe("soul text timing (docs/ko/first-run-scenario.md, prototype LINES)", () => {
  it("starts each character 35 ms after the previous one, from its word's time", () => {
    const { glyphs } = layoutLine({ index: 0, words: [{ t: "Hello.", at: 3000 }], out: 4400 });
    expect(glyphs.map((g) => g.char).join("")).toBe("Hello.");
    expect(glyphs.map((g) => g.inAt)).toEqual([3000, 3035, 3070, 3105, 3140, 3175]);
  });

  it("shows a cap letter at `cap` and grows the rest of the word from `at`", () => {
    const { glyphs } = layoutLine({ index: 2, words: [{ t: "Endue's", cap: 7800, at: 8050 }], out: 11000 });
    expect(glyphs.map((g) => g.inAt)).toEqual([7800, 8050, 8085, 8120, 8155, 8190, 8225]);
    expect(glyphs[0]?.gold).toBe(true);
    expect(glyphs[1]?.gold).toBe(false);
  });

  it("scatters 1.6 s long with 0-450 ms delays that repeat for the same seed", () => {
    const a = scatterDelays(40, 7);
    const b = scatterDelays(40, 7);
    expect(a).toEqual(b);
    expect(a).not.toEqual(scatterDelays(40, 8));
    expect(a.every((d) => d >= 0 && d < 450)).toBe(true);
    expect(WISP.outMs).toBe(1600);
    expect(WISP.inMs).toBe(900);
    const { glyphs } = layoutLine({ index: 3, words: [{ t: "Small,", at: 11500 }], out: 13400 });
    expect(glyphs.map((g) => (g.outAt ?? 0) - 13400)).toEqual(scatterDelays(6, 3));
  });

  it("keeps a line without `out` on screen", () => {
    const { glyphs } = layoutLine({ index: 5, words: [{ t: "you?", at: 17800 }], out: null });
    expect(glyphs.every((g) => g.outAt === null)).toBe(true);
  });

  it("splits a sentence by character count when there are no voice timestamps", () => {
    expect(wordsFromText("Small, I know.", 1000, 1400)).toEqual([
      { t: "Small,", at: 1000 },
      { t: "I", at: 1700 },
      { t: "know.", at: 1900 },
    ]);
  });

  it("solemn has no per-character stagger and no scatter jitter", () => {
    const { glyphs } = layoutLine({ index: 1, words: [{ t: "Hi", at: 500 }], out: 2000 }, SOLEMN);
    expect(glyphs.map((g) => g.inAt)).toEqual([500, 500]);
    expect(glyphs.map((g) => g.outAt)).toEqual([2000, 2000]);
  });

  it("marks the user's name without glow except a trailing period", () => {
    const { glyphs } = layoutLine({
      index: 6,
      words: [{ t: "Ada.", at: 2050, user: true, plainLast: true }],
      out: null,
    });
    expect(glyphs.map((g) => g.user)).toEqual([true, true, true, false]);
  });
});
