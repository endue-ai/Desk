// The README of a new theme: how to run, choose, check and share it, and what each palette role and
// layer of its plugin.json does (JSON has no comments, so the palette's are here).

import type { PluginOptions } from "./template";

const FENCE = "```";

/** One row per group of roles: the tokens, then what they paint. */
const PALETTE: ReadonlyArray<readonly [readonly string[], string]> = [
  [
    ["background", "card", "muted", "popover", "hover"],
    "The page, a card or panel, a sunken track, a menu or dialog, the hovered or selected row",
  ],
  [["text", "textMuted"], "Body text and secondary text on those surfaces"],
  [
    ["primary", "primaryForeground", "primaryHover"],
    "The main action: the brand fill, the ink on it, its hover",
  ],
  [
    ["primaryText", "primarySubtle", "primarySoft", "primaryBorder"],
    "The brand on neutral surfaces: as text (links), a faint and a soft tint, a border",
  ],
  ...["success", "warning", "danger", "info"].map(
    (s) =>
      [
        [s, `${s}Foreground`, `${s}Text`, `${s}Soft`, `${s}Border`],
        `${s[0]?.toUpperCase()}${s.slice(1)}: a fill, the ink on it, the colour as text, a tinted surface, its border`,
      ] as const,
  ),
  [
    ["border", "input", "ring"],
    "Dividers, the border of an input or an idle control, the focus ring",
  ],
  [["tooltip", "tooltipText", "scrim"], "A tooltip and its text, the shade behind a dialog"],
  [["shadowSm", "shadowMd", "shadowLg"], "Three elevations (CSS shadows, not colours)"],
  [
    Array.from({ length: 8 }, (_, i) => `chart${i + 1}`),
    "Categories for charts and lanes, used in order",
  ],
];

const LAYERS: ReadonlyArray<readonly [string, string, string, string]> = [
  [
    "Type",
    "type",
    "the desk's font stacks, `scale` 1, `tracking` 0",
    "`sans` and `mono` stacks, `scale` 0.85–1.25, `tracking` −0.02–0.05 em, `fonts`: up to eight `.woff2` files here (`family`, `src`, `weight`, `style`)",
  ],
  [
    "Shape",
    "shape",
    "`radius` soft, `density` comfortable",
    "radius none, subtle, soft or round; density compact, comfortable or spacious",
  ],
  [
    "Motion",
    "motion",
    "`personality` smooth",
    "snappy, smooth or calm; reduced motion still stops everything",
  ],
  [
    "Material",
    "material",
    "`opacity` 1, `blur` 0, `noise` 0, `border` 1, `shadow` soft",
    "per scheme: opacity 0.6–1 (the backdrop shows through), blur 0–24 px, grain 0–0.15, border 0–2 px, shadow none, soft or strong",
  ],
  [
    "Backdrop",
    "backdrop",
    "none",
    "per scheme: a `color`, a `gradient` of two to four colours at an `angle`, or an `image` here (`.png`, `.jpg`, `.webp`) with `fit` cover or tile; a `glow` at the top",
  ],
  [
    "Terminal",
    "terminal",
    "the desk's",
    "per scheme: `ansi`, sixteen colours from black to bright white",
  ],
];

const row = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
const code = (names: readonly string[]) => names.map((n) => `\`${n}\``).join(", ");

/** The README for a theme whose manifest gives it `license`. */
export function themeReadme({ id, name, description }: PluginOptions, license: string): string {
  const folder = "/path/to/this/folder";
  return [
    `# ${name}`,
    "",
    description ?? "A Desk theme.",
    "",
    `Id: \`${id}\`. Ids are lowercase and reverse-domain; use a domain you own before you publish.`,
    "",
    "A plugin of kind `theme`: no code, only the `theme` block in `plugin.json` and the font and image",
    "files it names. It starts with neutral surfaces and a teal brand, every other layer at its default.",
    "",
    "## Run it",
    "",
    "From the Desk repository, run Desk with this folder as a dev plugin, then choose the theme in the",
    "theme studio (the palette button at the top right, or Themes in the command palette) or with:",
    "",
    `${FENCE}bash`,
    `DESK_DEV_PLUGINS=${folder} just dev`,
    `cargo run -p desk-cli -- theme apply ${id}`,
    FENCE,
    "",
    "## The palette",
    "",
    "`light.colors` and `dark.colors` give each role a CSS colour. A role left out keeps the desk's.",
    "",
    row(["Tokens", "What they paint"]),
    row(["---", "---"]),
    ...PALETTE.map(([names, what]) => row([code(names), what])),
    "",
    "The shell's tokens (`secondary`, `statusActive`, `glow`, …) and Eris's (`eris`, `erisGlow`, …) take",
    "colours too: see `plugins/shell/plugin.json`. Text needs 4.5:1 on its ground, borders and fills",
    "3:1. The desk gates every theme it applies and moves a foreground's lightness when a pair falls",
    "short; the test fails until no pair needs that. High contrast is derived from this palette.",
    "",
    "## The layers",
    "",
    row(["Layer", "Key", "Here", "Choices"]),
    row(["---", "---", "---", "---"]),
    ...LAYERS.map(([layer, key, here, choices]) => row([layer, `\`${key}\``, here, choices])),
    "",
    "Fonts and images live in this folder: 2 MiB each and 8 MiB together, no SVG. Name their licence in",
    "`license`, an SPDX expression such as `Apache-2.0 AND OFL-1.1`, and keep each font's licence file",
    "beside it.",
    "",
    "## Check it",
    "",
    `${FENCE}bash`,
    `cargo run -p desk-cli -- plugin validate ${folder}`,
    `pnpm exec vitest run --root ${folder}`,
    FENCE,
    "",
    "`desk plugin validate` checks the manifest against specs/plugin v0 and the files against their",
    "limits. `tests/theme.test.ts` compiles both schemes and gates them over the endue palette, as the",
    "desk does before it applies a theme; it imports the Desk repository by path.",
    "",
    "## Share it",
    "",
    `${FENCE}bash`,
    `cargo run -p desk-cli -- theme export ${id}`,
    FENCE,
    "",
    `writes \`${id}.desk-theme\` to Downloads: one JSON file with \`plugin.json\` and the files it`,
    "names. `desk theme import <file>` installs it on another desk as a user theme.",
    "",
    `Licence: \`${license}\`. Change \`license\` in \`plugin.json\` to the one you give the theme.`,
    "",
    "Guide: `docs/plugins/authoring.md` (Making a theme) in the Desk repository.",
    "",
  ].join("\n");
}
