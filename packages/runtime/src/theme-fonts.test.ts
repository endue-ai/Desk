import { describe, expect, it } from "vitest";
import { applyThemeFonts, type FontHost } from "./theme-fonts";

class FakeFace {
  constructor(
    readonly family: string,
    readonly source: string,
    readonly descriptors: FontFaceDescriptors = {},
  ) {}
  load() {
    return Promise.resolve(this);
  }
}

function host(): FontHost & { faces: Set<FakeFace> } {
  const faces = new Set<FakeFace>();
  return {
    faces,
    fonts: {
      add: (face) => faces.add(face as unknown as FakeFace),
      delete: (face) => faces.delete(face as unknown as FakeFace),
    },
    FontFace: FakeFace as unknown as FontHost["FontFace"],
  };
}

describe("the active theme's fonts in the shell", () => {
  it("are added as FontFace with their weight and style", () => {
    const shell = host();
    applyThemeFonts(shell, [
      {
        family: "Literata",
        url: "desk-plugin://localhost/example.paper/fonts/l.woff2?v=1",
        weight: "200 900",
      },
    ]);
    const [face] = [...shell.faces];
    expect(face?.family).toBe("Literata");
    expect(face?.source).toBe('url("desk-plugin://localhost/example.paper/fonts/l.woff2?v=1")');
    expect(face?.descriptors).toMatchObject({ weight: "200 900", display: "swap" });
  });

  it("leave when the theme changes, and the same font is not added twice", () => {
    const shell = host();
    const a = { family: "A", url: "/a.woff2" };
    const b = { family: "B", url: "/b.woff2", style: "italic" };
    applyThemeFonts(shell, [a, b]);
    applyThemeFonts(shell, [b]);
    expect([...shell.faces].map((f) => f.family)).toEqual(["B"]);
    applyThemeFonts(shell, [b]);
    expect(shell.faces.size).toBe(1);
    applyThemeFonts(shell, []);
    expect(shell.faces.size).toBe(0);
  });

  it("do nothing where the browser has no FontFace", () => {
    expect(() =>
      applyThemeFonts({ fonts: undefined, FontFace: undefined }, [{ family: "A", url: "/a" }]),
    ).not.toThrow();
  });
});
