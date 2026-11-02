// The terminal follows the theme whole (docs/ko/theme-requirements.md TP-05): the sixteen ANSI
// colours come from the --desk-ansi-* variables a theme sets per scheme, a missing one falls back to
// what the page's tokens.css declares, and the page has no colour, font, size or radius of its own.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type InstalledTheme, resolveTheme } from "../../../packages/runtime/src/theme";
import { colors, terminal } from "../../../packages/ui/src/tokens";
import { lintPlugin } from "../../../scripts/ui-lint.mjs";
import { DEFAULTS } from "../ui/shell.js";
import { THEME_VARIABLES, terminalOptions, xtermTheme } from "../ui/theme.js";

/** xterm's names for the colours of --desk-ansi-0 … --desk-ansi-15. */
const NAMES = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;
const SIXTEEN = NAMES.map((_, i) => i);

type Scheme = "dark" | "light";
type Contribution = {
  id: string;
  scheme: Scheme;
  contrast?: string;
  tokens: Record<string, string>;
};

const root = join(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const deskTheme = JSON.parse(read("plugins/theme/plugin.json")) as {
  contributes: { themes: Contribution[] };
};
const themes = deskTheme.contributes.themes;
const light = themes.find((t) => t.scheme === "light" && (t.contrast ?? "normal") === "normal");
if (!light) throw new Error("desk.theme has no light contribution");

const state = (scheme: Scheme, variables: Record<string, string> = {}) =>
  ({ scheme, contrast: "normal", reducedMotion: false, variables }) as const;

/** The sixteen colours xterm was given, black to bright white. */
const sixteen = (theme: Record<string, unknown>) => NAMES.map((name) => theme[name]);

/** Sixteen colours unlike the desk's: #<base>, #<base + 010101>, … */
const palette = (base: number) =>
  SIXTEEN.map((i) => `#${(base + i * 0x010101).toString(16).padStart(6, "0")}`);
const asVariables = (ansi: string[]) =>
  Object.fromEntries(ansi.map((color, i) => [`--desk-ansi-${i}`, color]));

/** What the runtime hands a frame for these settings, as the frame's ctx.theme sees it. */
function resolved(scheme: Scheme, active = "", installed: InstalledTheme[] = [], high = false) {
  const theme = resolveTheme(
    themes as never,
    { scheme, contrast: high ? "high" : "normal", motion: "full", active },
    { dark: scheme === "dark", highContrast: high, reducedMotion: false },
    installed,
  );
  const { contrast, reducedMotion, variables } = theme;
  return { scheme: theme.scheme, contrast, reducedMotion, variables };
}

describe("the terminal's ANSI colours", () => {
  it("are the theme's --desk-ansi-* variables, in both schemes", () => {
    for (const [scheme, base] of [
      ["dark", 0x102030],
      ["light", 0x403020],
    ] as const) {
      const ansi = palette(base);
      expect(sixteen(xtermTheme(state(scheme, asVariables(ansi))))).toEqual(ansi);
    }
  });

  it("come from desk.theme, and from a theme plugin that sets its own, per scheme", () => {
    expect(sixteen(xtermTheme(resolved("dark")))).toEqual(
      SIXTEEN.map((i) => terminal[`ansi${i}` as keyof typeof terminal]),
    );
    expect(sixteen(xtermTheme(resolved("light")))).toEqual(
      SIXTEEN.map((i) => light.tokens[`ansi${i}`]),
    );
    const dark = palette(0x203040);
    const bright = palette(0x605040);
    const installed: InstalledTheme[] = [
      {
        id: "test.ansi",
        name: "ANSI",
        theme: { dark: { terminal: { ansi: dark } }, light: { terminal: { ansi: bright } } },
        url: (path) => path,
      },
    ];
    expect(sixteen(xtermTheme(resolved("dark", "test.ansi", installed)))).toEqual(dark);
    expect(sixteen(xtermTheme(resolved("light", "test.ansi", installed)))).toEqual(bright);
    // High contrast keeps the theme's colours and still asks xterm for 7:1 on every cell.
    const high = terminalOptions(DEFAULTS, resolved("dark", "test.ansi", installed, true));
    expect(sixteen(high.theme)).toEqual(dark);
    expect(high.minimumContrastRatio).toBe(7);
  });

  it("fall back one by one to the page's tokens.css, which declares every one of them", () => {
    expect(read("plugins/terminal/ui/index.html")).toContain('href="/_desk/tokens.css"');
    const declared = Object.fromEntries(
      [...read("packages/ui/src/tokens.css").matchAll(/(--desk-[a-z0-9-]+):\s*([^;]+);/g)].map(
        ([, name, value]) => [name, value?.trim()],
      ),
    );
    expect(THEME_VARIABLES.filter((name) => !declared[name])).toEqual([]);
    // What main.js reads from the page before the desk's theme arrives.
    const page = Object.fromEntries(THEME_VARIABLES.map((name) => [name, declared[name] ?? ""]));
    const defaults: string[] = SIXTEEN.map((i) => terminal[`ansi${i}` as keyof typeof terminal]);
    const some = { "--desk-ansi-1": "#ff0000", "--desk-ansi-2": "" };
    for (const scheme of ["dark", "light"] as const) {
      const expected = [...defaults];
      expected[1] = "#ff0000";
      expect(sixteen(xtermTheme(state(scheme, some), page))).toEqual(expected);
      expect(sixteen(xtermTheme(state(scheme), page))).toEqual(defaults);
    }
    expect(xtermTheme(state("dark"), page)).toMatchObject({
      background: colors.background,
      foreground: colors.text,
      cursor: colors.accent,
    });
  });
});

describe("the terminal's page", () => {
  it("reads every colour, font, size and radius from the theme's tokens", () => {
    expect(lintPlugin("terminal")).toEqual([]);
  });
});
