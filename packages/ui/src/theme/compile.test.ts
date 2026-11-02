import type { ThemePackage } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { scale } from "../tokens";
import { compileTheme } from "./index";

const url = (path: string) => `desk-plugin://localhost/example.paper/${path}?v=3`;

describe("compileTheme", () => {
  it("turns presets into the scale's tokens", () => {
    const theme: ThemePackage = {
      shape: { radius: "round", density: "compact" },
      motion: { personality: "snappy" },
      dark: {},
    };
    const { tokens } = compileTheme(theme, "dark");
    expect(tokens).toMatchObject({
      radiusSm: "6px",
      radiusMd: "12px",
      radiusLg: "18px",
      controlXs: "24px",
      controlLg: "44px",
      motionFast: "100ms",
      motionTheme: "200ms",
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
    expect(compileTheme({ shape: { radius: "none" }, dark: {} }, "dark").tokens.radiusMd).toBe(
      "0px",
    );
  });

  it("names the desk's own design as the middle presets", () => {
    const { tokens } = compileTheme(
      {
        shape: { radius: "soft", density: "comfortable" },
        motion: { personality: "smooth" },
        dark: {},
      },
      "dark",
    );
    for (const [name, value] of Object.entries(tokens))
      expect(value, name).toBe((scale as Record<string, string>)[name]);
  });

  it("scales every text size and sets tracking and typefaces", () => {
    const { tokens } = compileTheme(
      { type: { sans: '"Literata", Georgia, serif', scale: 1.25, tracking: 0.01 }, light: {} },
      "light",
    );
    expect(tokens.textSm).toBe("18px");
    expect(tokens.text2xs).toBe("14px");
    expect(tokens.text4xl).toBe("50px");
    expect(tokens.tracking).toBe("0.01em");
    expect(tokens.fontSans).toBe('"Literata", Georgia, serif');
  });

  it("sets material, shadows and the shell's surface from the scheme's variant", () => {
    const theme: ThemePackage = {
      dark: {
        colors: { card: "#202830", shadowSm: "0 0 1px #000" },
        material: { opacity: 0.8, blur: 12, noise: 0.06, border: 0, shadow: "strong" },
      },
    };
    const { tokens } = compileTheme(theme, "dark");
    expect(tokens).toMatchObject({
      surfaceOpacity: "0.8",
      blur: "12px",
      noise: "0.06",
      borderWidth: "0px",
      surface: "color-mix(in srgb, #202830 80%, transparent)",
      surfaceFilter: "blur(12px) saturate(1.2)",
      shadowMd: "0 12px 32px rgba(0, 0, 0, 0.55)",
    });
    expect(tokens.shadowSm, "a shadow token in colors wins over the preset").toBe("0 0 1px #000");
    expect(compileTheme({ dark: { material: { shadow: "none" } } }, "dark").tokens.shadowLg).toBe(
      "none",
    );
  });

  it("draws the backdrop from an image, a gradient or a colour, and keeps the glow", () => {
    const image = compileTheme(
      { light: { backdrop: { image: "images/paper.webp", fit: "tile", glow: "#d9c9a8" } } },
      "light",
      url,
    ).tokens;
    expect(image).toMatchObject({
      backdrop: 'url("desk-plugin://localhost/example.paper/images/paper.webp?v=3")',
      backdropSize: "auto",
      backdropRepeat: "repeat",
      glow: "#d9c9a8",
    });
    const gradient = compileTheme(
      { dark: { backdrop: { gradient: ["#0f2027", "#2c5364"], angle: 160 } } },
      "dark",
    ).tokens;
    expect(gradient.backdrop).toBe("linear-gradient(160deg, #0f2027, #2c5364)");
    const solid = compileTheme({ dark: { backdrop: { color: "#101010" } } }, "dark").tokens;
    expect(solid.backdrop).toBe("linear-gradient(#101010, #101010)");
  });

  it("gives the terminal its sixteen colours", () => {
    const ansi = Array.from(
      { length: 16 },
      (_, i) => `#0000${(i * 16).toString(16).padStart(2, "0")}`,
    );
    const { tokens } = compileTheme({ dark: { terminal: { ansi } } }, "dark");
    expect(tokens.ansi0).toBe("#000000");
    expect(tokens.ansi15).toBe("#0000f0");
  });

  it("resolves fonts to URLs and keeps their weight and style", () => {
    const { fonts } = compileTheme(
      {
        type: {
          fonts: [
            { family: "Literata", src: "fonts/literata.woff2", weight: "200 900" },
            { family: "Literata", src: "fonts/literata-italic.woff2", style: "italic" },
          ],
        },
        light: {},
      },
      "light",
      url,
    );
    expect(fonts).toEqual([
      { family: "Literata", url: url("fonts/literata.woff2"), weight: "200 900" },
      { family: "Literata", url: url("fonts/literata-italic.woff2"), style: "italic" },
    ]);
  });

  it("keeps the shared layers but not the palette in a scheme the theme lacks", () => {
    const compiled = compileTheme(
      { shape: { radius: "none" }, light: { colors: { background: "#ffffff" } } },
      "dark",
    );
    expect(compiled.hasScheme).toBe(false);
    expect(compiled.tokens.radiusMd).toBe("0px");
    expect(compiled.tokens.background).toBeUndefined();
  });

  it("takes preview colours from the theme or its palette", () => {
    expect(compileTheme({ preview: ["#111111", "#eeeeee"], dark: {} }, "dark").preview).toEqual([
      "#111111",
      "#eeeeee",
    ]);
    const derived = compileTheme(
      { dark: { colors: { background: "#101010", text: "#fafafa", primary: "#ff8a4c" } } },
      "dark",
    );
    expect(derived.preview).toEqual(["#101010", "#fafafa", "#ff8a4c"]);
  });

  it("clamps numbers and drops unsafe values from a theme that skipped the schema", () => {
    const wild = {
      type: { sans: "x; } body { display: none", scale: 9 },
      dark: {
        colors: { background: "url(https://evil.test/x.png)", text: "#fff", "bad-name": "#000" },
        material: { opacity: 0.1, blur: 400 },
        backdrop: { image: "../../etc/passwd" },
      },
    } as unknown as ThemePackage;
    const { tokens } = compileTheme(wild, "dark");
    expect(tokens.fontSans).toBeUndefined();
    expect(tokens.textSm).toBe("18px");
    expect(tokens.background).toBeUndefined();
    expect(tokens["bad-name"]).toBeUndefined();
    expect(tokens.text).toBe("#fff");
    expect(tokens.surfaceOpacity).toBe("0.6");
    expect(tokens.blur).toBe("24px");
    expect(tokens.backdrop).toBeUndefined();
  });
});
