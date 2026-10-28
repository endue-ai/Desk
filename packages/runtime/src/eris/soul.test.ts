import { expect, test } from "vitest";
import { APPEAR_MS, holdMs, nextStart, planLine, scatter, wispGlyph } from "./soul";

test("without timestamps, glyphs condense 35 ms apart", () => {
  const line = planLine(0, "Hi there", 1000, { style: "wisp" });
  expect(line.glyphs.map((g) => g.at)).toEqual([1000, 1035, 1070, 1105, 1140, 1175, 1210]);
});

test("with TTS timestamps, a word's glyphs start when the word is spoken", () => {
  const line = planLine(0, "Good morning", 0, {
    style: "wisp",
    words: [
      { word: "Good", at: 0 },
      { word: "morning", at: 400 },
    ],
    lead: 220,
  });
  expect(line.glyphs[4]?.at).toBe(620);
  expect(line.glyphs[5]?.at).toBe(655);
});

test("the hold grows from 1.0 s to 1.4 s with the sentence", () => {
  expect(holdMs("ok")).toBeCloseTo(1013, 0);
  expect(holdMs("x".repeat(90))).toBe(1400);
});

test("E, R, I and S of Eris are marked; the user's name is marked", () => {
  const line = planLine(0, "Eris greets Dongsoo.", 0, { style: "wisp", userName: "Dongsoo" });
  expect(
    line.glyphs
      .filter((g) => g.eris)
      .map((g) => g.ch)
      .join(""),
  ).toBe("Eris");
  expect(line.glyphs.filter((g) => g.user)).toHaveLength(8);
});

test("a glyph condenses from blur 14 px, 8 px low, 112 % to rest in 900 ms", () => {
  const line = planLine(0, "A", 0, { style: "wisp" });
  const g = line.glyphs[0];
  if (!g) throw new Error("no glyph");
  expect(wispGlyph(line, g, 0)).toMatchObject({ opacity: 0, blur: 14, y: 8, scale: 1.12 });
  expect(wispGlyph(line, g, APPEAR_MS)).toMatchObject({ opacity: 1, blur: 0, y: 0, scale: 1 });
});

test("scatter delays are deterministic and under 450 ms", () => {
  expect(scatter(3, 1)).toEqual(scatter(3, 1));
  for (let k = 0; k < 50; k++) expect(scatter(k, 2).delay).toBeLessThan(450);
});

test("the next line waits until 300 ms after the previous one starts to scatter", () => {
  const first = planLine(0, "One", 0, { style: "wisp" });
  expect(nextStart(first, 10)).toBe(first.dissolveAt + 300);
  expect(nextStart(undefined, 10)).toBe(10);
});
