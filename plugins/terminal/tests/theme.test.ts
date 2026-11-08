import { describe, expect, it } from "vitest";
import { cssVariables, tokens } from "../../../packages/ui/src/tokens";
import { DEFAULTS } from "../ui/shell.js";
import { MONOSPACE, THEME_VARIABLES, terminalOptions, withAlpha, xtermTheme } from "../ui/theme.js";

const dark = { scheme: "dark", contrast: "normal", reducedMotion: false, variables: {} } as const;

/** What the page's tokens.css declares for xterm's colours: main.js reads it from the page. */
const variables = cssVariables(tokens);
const page = Object.fromEntries(THEME_VARIABLES.map((name) => [name, variables[name] ?? ""]));

describe("the terminal's theme", () => {
  it("takes the screen, text, cursor and ANSI colours from the desk's tokens, the page's by default", () => {
    expect(xtermTheme(dark, page)).toMatchObject({
      background: "#141416",
      foreground: "#f2f0f5",
      cursor: "#b6a3f5",
      cursorAccent: "#141416",
      selectionBackground: "#b6a3f559",
      black: "#1e1d21",
      red: "#ff8484",
      brightWhite: "#ffffff",
    });
    const themed = xtermTheme(
      {
        ...dark,
        scheme: "light",
        variables: {
          "--desk-background": "#ffffff",
          "--desk-text": "#111111",
          "--desk-accent": "#336699",
          "--desk-ansi-1": "#aa0000",
        },
      },
      page,
    );
    expect(themed).toMatchObject({
      background: "#ffffff",
      foreground: "#111111",
      cursor: "#336699",
      selectionBackground: "#33669959",
      red: "#aa0000",
      green: "#5dbe5f",
    });
  });

  it("leaves a colour that neither the theme nor the page gives to xterm", () => {
    expect(xtermTheme(dark)).toEqual({});
    expect(xtermTheme({ ...dark, variables: { "--desk-ansi-4": "#0000ff" } })).toEqual({
      blue: "#0000ff",
    });
  });

  it("selects with the text colour itself in high contrast", () => {
    const high = xtermTheme({ ...dark, contrast: "high" }, page);
    expect(high.selectionBackground).toBe("#f2f0f5");
    expect(high.selectionForeground).toBe("#141416");
    expect(xtermTheme(dark, page).selectionForeground).toBeUndefined();
  });

  it("adds an alpha to six-digit hex colours only", () => {
    expect(withAlpha("#b6a3f5", 0.35)).toBe("#b6a3f559");
    expect(withAlpha("#B6A3F5", 1)).toBe("#B6A3F5ff");
    expect(withAlpha("rgba(0, 0, 0, 0.6)", 0.5)).toBe("rgba(0, 0, 0, 0.6)");
    expect(withAlpha("#fff", 0.5)).toBe("#fff");
  });
});

describe("the terminal's options", () => {
  it("come from the settings and the theme", () => {
    expect(terminalOptions(DEFAULTS, dark, page)).toEqual({
      allowProposedApi: true,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: MONOSPACE,
      fontSize: 13,
      scrollback: 10000,
      minimumContrastRatio: 1,
      theme: xtermTheme(dark, page),
    });
    expect(
      terminalOptions(
        { ...DEFAULTS, fontFamily: "JetBrains Mono", fontSize: 15, cursorStyle: "bar" },
        dark,
      ),
    ).toMatchObject({ fontFamily: "JetBrains Mono", fontSize: 15, cursorStyle: "bar" });
  });

  it("stop the cursor blinking under reduced motion and ask for 7:1 in high contrast", () => {
    expect(terminalOptions(DEFAULTS, { ...dark, reducedMotion: true }).cursorBlink).toBe(false);
    expect(terminalOptions(DEFAULTS, { ...dark, contrast: "high" }).minimumContrastRatio).toBe(7);
  });
});

describe("the terminal's options", () => {
  it("lets xterm load its proposed-API addons (Unicode 11)", () => {
    expect(terminalOptions(DEFAULTS, dark).allowProposedApi).toBe(true);
  });
});
