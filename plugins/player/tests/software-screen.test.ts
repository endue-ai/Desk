// The software player's colours: Y'CbCr to RGB as the 2D fallback draws it, with the same
// coefficients the WebGL shader gets (BT.601 and BT.709, limited and full range, gray pictures).
import { describe, expect, it } from "vitest";
import { coefficients, toRgba } from "../ui/software/screen.js";

const near = (value: number) => expect.closeTo(value, 6);

describe("the screen's colours", () => {
  const plain = (
    y: number,
    u: number,
    v: number,
    full = false,
    matrix: "bt601" | "bt709" = "bt601",
  ) =>
    Array.from(
      toRgba({
        width: 1,
        height: 1,
        planes: [Uint8Array.of(y), Uint8Array.of(u), Uint8Array.of(v)],
        widths: [1, 1, 1],
        heights: [1, 1, 1],
        full,
        matrix,
      }).subarray(0, 3),
    );

  it("limited and full range white and black", () => {
    expect(plain(235, 128, 128)).toEqual([255, 255, 255]);
    expect(plain(16, 128, 128)).toEqual([0, 0, 0]);
    expect(plain(255, 128, 128, true)).toEqual([255, 255, 255]);
    expect(plain(0, 128, 128, true)).toEqual([0, 0, 0]);
  });

  it("BT.601 and BT.709 red", () => {
    const red601 = plain(81, 90, 240);
    expect(red601[0]).toBeGreaterThan(250);
    expect(red601[1]).toBeLessThan(5);
    expect(red601[2]).toBeLessThan(5);
    const red709 = plain(63, 102, 240, false, "bt709");
    expect(red709[0]).toBeGreaterThan(250);
    expect(red709[1]).toBeLessThan(5);
    expect(coefficients("bt601", true).rows[0]?.[2]).toEqual(near(1.402));
    expect(coefficients("bt709", true).rows[2]?.[1]).toEqual(near(1.8556));
  });

  it("a gray picture has only its Y plane", () => {
    const rgba = toRgba({
      width: 2,
      height: 1,
      planes: [Uint8Array.of(16, 235)],
      widths: [2],
      heights: [1],
      full: false,
      matrix: "bt601",
    });
    expect(Array.from(rgba)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it("chroma planes of half the size are sampled by their nearest sample", () => {
    const rgba = toRgba({
      width: 2,
      height: 2,
      planes: [Uint8Array.of(126, 126, 126, 126), Uint8Array.of(128), Uint8Array.of(128)],
      widths: [2, 1, 1],
      heights: [2, 1, 1],
      full: false,
      matrix: "bt601",
    });
    expect(new Set(Array.from(rgba).filter((_, i) => i % 4 !== 3)).size).toBe(1);
  });
});
